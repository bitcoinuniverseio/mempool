import type { TransactionStripped } from '@interfaces/node-api.interface';

export function identifyPrioritizedTransactions(transactions: TransactionStripped[]): { prioritized: string[], deprioritized: string[] } {
  // find the longest increasing subsequence of transactions
  // (adapted from https://en.wikipedia.org/wiki/Longest_increasing_subsequence#Efficient_algorithms)
  // should be O(n log n)
  const X = transactions.slice(1).reverse(); // standard block order is by *decreasing* effective fee rate, but we want to iterate in increasing order (and skip the coinbase)
  if (X.length < 2) {
    return { prioritized: [], deprioritized: [] };
  }
  const N = X.length;
  const P: number[] = new Array(N);
  const M: number[] = new Array(N + 1);
  M[0] = -1; // undefined so can be set to any value

  let L = 0;
  for (let i = 0; i < N; i++) {
    // Binary search for the smallest positive l ≤ L
    // such that X[M[l]].effectiveFeePerVsize > X[i].effectiveFeePerVsize
    let lo = 1;
    let hi = L + 1;
    while (lo < hi) {
      const mid = lo + Math.floor((hi - lo) / 2); // lo <= mid < hi
      if (X[M[mid]].rate > X[i].rate) {
        hi = mid;
      } else { // if X[M[mid]].effectiveFeePerVsize < X[i].effectiveFeePerVsize
        lo = mid + 1;
      }
    }

    // After searching, lo == hi is 1 greater than the
    // length of the longest prefix of X[i]
    const newL = lo;

    // The predecessor of X[i] is the last index of
    // the subsequence of length newL-1
    P[i] = M[newL - 1];
    M[newL] = i;

    if (newL > L) {
      // If we found a subsequence longer than any we've
      // found yet, update L
      L = newL;
    }
  }

  // Reconstruct the longest increasing subsequence
  // It consists of the values of X at the L indices:
  // ..., P[P[M[L]]], P[M[L]], M[L]
  const LIS: TransactionStripped[] = new Array(L);
  let k = M[L];
  for (let j = L - 1; j >= 0; j--) {
    LIS[j] = X[k];
    k = P[k];
  }

  const lisMap = new Map<string, number>();
  LIS.forEach((tx, index) => lisMap.set(tx.txid, index));

  const prioritized: string[] = [];
  const deprioritized: string[] = [];

  let lastRate = 0;

  for (const tx of X) {
    if (lisMap.has(tx.txid)) {
      lastRate = tx.rate;
    } else {
      if (Math.abs(tx.rate - lastRate) < 0.1) {
        // skip if the rate is almost the same as the previous transaction
      } else if (tx.rate <= lastRate) {
        prioritized.push(tx.txid);
      } else {
        deprioritized.push(tx.txid);
      }
    }
  }

  return { prioritized, deprioritized };
}
