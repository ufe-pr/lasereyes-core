import * as bitcoin from "bitcoinjs-lib";
import { GetAddressOptions, RpcErrorCode, getAddress, request } from "sats-connect";
import { UNSUPPORTED_PROVIDER_METHOD_ERROR, WalletProvider } from ".";
import {
  ProviderType,
  NetworkType,
  XVERSE,
  LOCAL_STORAGE_DEFAULT_WALLET,
  getXverseNetwork,
  MAINNET,
  TESTNET,
  TESTNET4,
  SIGNET,
  FRACTAL_TESTNET,
} from "../..";
import {
  findOrdinalsAddress,
  findPaymentAddress,
  getBTCBalance,
  getBitcoinNetwork,
} from "../../lib/helpers";

export default class XVerseProvider extends WalletProvider {
  public get library(): any | undefined {
    return (window as any).BitcoinProvider;
  }

  public get network(): NetworkType {
    return this.$network.get();
  }
  observer?: MutationObserver;

  initialize(): void {
    this.observer = new MutationObserver(() => {
      const xverseLib = (window as any)?.XverseProviders?.BitcoinProvider;
      if (xverseLib) {
        this.$store.setKey("hasProvider", {
          ...this.$store.get().hasProvider,
          [XVERSE]: true,
        });
        this.observer?.disconnect();
      }
    });
    this.observer.observe(document, { childList: true, subtree: true });
  }
  addListeners() {}

  removeListeners() {}

  dispose() {
    this.observer?.disconnect();
    this.removeListeners();
  }

  async connect(_: ProviderType): Promise<void> {
    try {
      localStorage?.setItem(LOCAL_STORAGE_DEFAULT_WALLET, XVERSE);
      let xverseNetwork = getXverseNetwork(this.network || MAINNET);
      const getAddressOptions = {
        payload: {
          purposes: ["ordinals", "payment"],
          message: "Address for receiving Ordinals and payments",
          network: {
            type: xverseNetwork,
          },
        },
        onFinish: (response: any) => {
          this.$store.setKey("publicKey", String(response.addresses[0].publicKey));
          this.$store.setKey("paymentPublicKey", String(response.addresses[1].publicKey));

          const foundAddress = findOrdinalsAddress(response.addresses);
          const foundPaymentAddress = findPaymentAddress(response.addresses);
          if (foundAddress && foundPaymentAddress) {
            this.$store.setKey("address", foundAddress.address);
            this.$store.setKey("paymentAddress", foundPaymentAddress.address);
            this.$store.setKey("provider", XVERSE);
          }

          getBTCBalance(foundPaymentAddress.address, this.network).then((totalBalance) => {
            this.$store.setKey("balance", totalBalance);
          });
        },
        onCancel: () => {
          throw new Error(`User canceled lasereyes to ${XVERSE} wallet`);
        },
        onError: (_: any) => {
          throw new Error(`Can't lasereyes to ${XVERSE} wallet`);
        },
      };
      await getAddress(getAddressOptions as GetAddressOptions);
      this.$store.setKey("connected", true);
    } catch (e) {
      throw e;
    }
  }

  async requestAccounts(): Promise<string[]> {
    return [this.$store.get().address];
  }

  async getNetwork(): Promise<NetworkType | undefined> {
    const { address } = this.$store.get();

    if (
      address.slice(0, 1) === "t" &&
      [TESTNET, TESTNET4, SIGNET, FRACTAL_TESTNET].includes(this.network)
    ) {
      return this.network;
    }

    return MAINNET;
  }
  getPublicKey(): Promise<string | undefined> {
    throw UNSUPPORTED_PROVIDER_METHOD_ERROR;
  }

  async getBalance(): Promise<string | number | bigint> {
    const { paymentAddress } = this.$store.get();
    return await getBTCBalance(paymentAddress, this.network);
  }

  getInscriptions(): Promise<any[]> {
    throw UNSUPPORTED_PROVIDER_METHOD_ERROR;
  }
  async sendBTC(to: string, amount: number): Promise<string> {
    const response = await request("sendTransfer", {
      recipients: [
        {
          address: to,
          amount: amount,
        },
      ],
    });
    if (response.status === "success") {
      return response.result.txid;
    } else {
      if (response.error.code === RpcErrorCode.USER_REJECTION) {
        throw new Error("User rejected the request");
      } else {
        throw new Error("Error sending BTC: " + response.error.message);
      }
    }
  }
  async signMessage(message: string, toSignAddress?: string | undefined): Promise<string> {
    const tempAddy = toSignAddress || this.$store.get().paymentAddress;
    const response = await request("signMessage", {
      address: tempAddy,
      message,
    });

    if (response.status === "success") {
      return response.result.signature as string;
    } else {
      if (response.error.code === RpcErrorCode.USER_REJECTION) {
        throw new Error("User rejected the request");
      } else {
        throw new Error("Error signing message: " + response.error.message);
      }
    }
  }
  async signPsbt(
    _: string,
    __: string,
    psbtBase64: string,
    _finalize?: boolean | undefined,
    broadcast?: boolean | undefined
  ): Promise<
    | {
        signedPsbtHex: string | undefined;
        signedPsbtBase64: string | undefined;
        txId?: string | undefined;
      }
    | undefined
  > {
    const { address, paymentAddress } = this.$store.get();
    const toSignPsbt = bitcoin.Psbt.fromBase64(String(psbtBase64), {
      network: getBitcoinNetwork(this.network),
    });

    const inputs = toSignPsbt.data.inputs;
    const inputsToSign = [];
    const ordinalAddressData = {
      address: address,
      signingIndexes: [] as number[],
    };
    const paymentsAddressData = {
      address: paymentAddress,
      signingIndexes: [] as number[],
    };

    let counter = 0;
    for await (let input of inputs) {
      if (input.witnessUtxo === undefined) {
        paymentsAddressData.signingIndexes.push(Number(counter));
      } else {
        const { script } = input.witnessUtxo!;
        const addressFromScript = bitcoin.address.fromOutputScript(
          script,
          getBitcoinNetwork(this.network)
        );
        if (addressFromScript === paymentAddress) {
          paymentsAddressData.signingIndexes.push(Number(counter));
        } else if (addressFromScript === address) {
          ordinalAddressData.signingIndexes.push(Number(counter));
        }
      }

      counter++;
    }

    if (ordinalAddressData.signingIndexes.length > 0) {
      inputsToSign.push(ordinalAddressData);
    }

    if (paymentsAddressData.signingIndexes.length > 0) {
      inputsToSign.push(paymentsAddressData);
    }

    let txId, signedPsbtHex, signedPsbtBase64;

    const xverseNetwork = getXverseNetwork(this.network);

    const signPsbtOptions = {
      payload: {
        network: {
          type: xverseNetwork,
        },
        message: "Sign Transaction",
        psbtBase64: toSignPsbt.toBase64(),
        broadcast: broadcast,
        inputsToSign: inputsToSign,
      },
      onFinish: (response: { psbtBase64: string; txId: string }) => {
        if (response.txId) {
          txId = response.txId;
        } else if (response.psbtBase64) {
          const signedPsbt = bitcoin.Psbt.fromBase64(String(response.psbtBase64), {
            network: getBitcoinNetwork(this.network),
          });

          signedPsbtHex = signedPsbt.toHex();
          signedPsbtBase64 = signedPsbt.toBase64();
        }
      },
      onCancel: () => console.log("Canceled"),
    };

    // @ts-ignore
    await signTransaction(signPsbtOptions);
    return {
      signedPsbtHex,
      signedPsbtBase64,
      txId,
    };
  }
  pushPsbt(_tx: string): Promise<string | undefined> {
    throw UNSUPPORTED_PROVIDER_METHOD_ERROR;
  }
}
