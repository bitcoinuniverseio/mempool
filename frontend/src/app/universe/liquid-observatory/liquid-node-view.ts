export interface LiquidNodeView {
  network: string;
  blockHeight: number;
  blockHash: string;
  initialBlockDownload: boolean;
  signblockScript: string;
  fedpegProgram: string;
  fedpegScript: string;
  source: 'owned-elements-rpc';
  scope: 'checkpoint-and-policy-only';
  reserveSats: null;
  activeAssetCount: null;
  signersOnline: null;
}
