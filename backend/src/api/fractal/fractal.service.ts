import { throwFirstPartyDataUnavailable } from '../_shared/first-party-data';
import {
  Cat20Holder,
  Cat20Token,
  FractalBlockSummary,
  FractalMempoolOverview,
  FractalTransactionView,
} from './fractal.types';

export class FractalService {
  /** @asyncSafe */
  public async $getTip(): Promise<{
    height: number;
    hash: string;
    time: number;
    network: string;
  }> {
    throwFirstPartyDataUnavailable('fractal');
  }

  /** @asyncSafe */
  public async $getMempool(): Promise<FractalMempoolOverview> {
    throwFirstPartyDataUnavailable('fractal');
  }

  /** @asyncSafe */
  public async $getBlock(
    hashOrHeight: string
  ): Promise<FractalBlockSummary | null> {
    void hashOrHeight;
    throwFirstPartyDataUnavailable('fractal');
  }

  /** @asyncSafe */
  public async $getTransaction(
    txid: string
  ): Promise<FractalTransactionView | null> {
    void txid;
    throwFirstPartyDataUnavailable('fractal');
  }

  /** @asyncSafe */
  public async $getCat20Tokens(): Promise<Cat20Token[]> {
    throwFirstPartyDataUnavailable('fractal');
  }

  /** @asyncSafe */
  public async $getCat20Token(tokenId: string): Promise<Cat20Token | null> {
    void tokenId;
    throwFirstPartyDataUnavailable('fractal');
  }

  /** @asyncSafe */
  public async $getCat20Holders(tokenId: string): Promise<Cat20Holder[]> {
    void tokenId;
    throwFirstPartyDataUnavailable('fractal');
  }
}

export const fractalService = new FractalService();
