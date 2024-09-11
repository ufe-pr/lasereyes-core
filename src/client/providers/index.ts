import { MapStore, WritableAtom } from "nanostores";
import { LaserEyesStoreType } from "../types";
import { Config, NetworkType, ProviderType } from "../../types";
import { LaserEyesClient } from "..";

export abstract class WalletProvider {
  readonly $store: MapStore<LaserEyesStoreType>;
  readonly $network: WritableAtom<NetworkType>;
  readonly $library: WritableAtom;

  constructor(
    stores: {
      readonly $store: MapStore<LaserEyesStoreType>;
      readonly $network: WritableAtom<NetworkType>;
      readonly $library: WritableAtom;
    },
    readonly parent: LaserEyesClient,
    readonly config?: Config,
  ) {
    this.$store = stores.$store;
    this.$network = stores.$network;
    this.$library = stores.$library;

    this.initialize();
  }

  abstract initialize(): void;

  abstract dispose(): void;

  abstract connect(defaultWallet: ProviderType): Promise<void>;

  disconnect(): void {}

  abstract requestAccounts(): Promise<string[]>;

  abstract switchNetwork(network: NetworkType): void;

  abstract getNetwork(): Promise<NetworkType | undefined>;

  abstract getPublicKey(): Promise<string | undefined>;

  abstract getBalance(): Promise<bigint | string | number>;

  abstract getInscriptions(): Promise<any[]>;

  abstract sendBTC(to: string, amount: number): Promise<string>;

  abstract signMessage(
    message: string,
    toSignAddress?: string
  ): Promise<string>;

  abstract signPsbt(
    tx: string,
    psbtHex: string,
    psbtBase64: string,
    finalize?: boolean,
    broadcast?: boolean,
  ): Promise<
    | {
        signedPsbtHex: string | undefined;
        signedPsbtBase64: string | undefined;
        txId?: string;
      }
    | undefined
  >;

  abstract pushPsbt(tx: string): Promise<string | undefined>;
}
