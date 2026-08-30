/**
 * Human descriptions for the protocols in the registry.
 *
 * The registry is a machine contract: ids, authorities, release status. It
 * carries no prose, and prose is what a visitor needs to understand what they
 * are looking at. Each entry here is written to be true whether or not the
 * explorer can currently read that protocol, and says what kind of on-chain
 * action it produces rather than what it is worth.
 */

export interface ProtocolCopy {
  /** One or two sentences: what this is, in plain language. */
  readonly summary: string;
  /** The action words this protocol produces on chain. */
  readonly actions: readonly string[];
  /** How to read the evidence for it on a transaction page. */
  readonly howToRead?: string;
}

const FAMILY_COPY: Record<string, ProtocolCopy> = {
  ORDINALS: {
    summary: $localize`:@@universe.copy.family-ordinals:Ordinals number every satoshi and let data be inscribed onto one of them, so content and identity ride along with an ordinary bitcoin output.`,
    actions: ['inscribe', 'transfer'],
  },
  RUNES: {
    summary: $localize`:@@universe.copy.family-runes:Runes are fungible tokens defined directly in a transaction's data output, with balances tracked against unspent outputs.`,
    actions: ['etch', 'mint', 'transfer'],
  },
  ALKANES: {
    summary: $localize`:@@universe.copy.family-alkanes:Alkanes puts programmable contracts on Bitcoin outputs, executed by an indexer rather than by consensus.`,
    actions: ['deploy', 'call', 'transfer'],
  },
  STAMPS: {
    summary: $localize`:@@universe.copy.family-stamps:Stamps store data inside outputs that cannot be pruned, so the content is as permanent as the UTXO set itself.`,
    actions: ['stamp', 'deploy', 'mint', 'transfer'],
  },
  ATOMICALS: {
    summary: $localize`:@@universe.copy.family-atomicals:Atomicals assigns digital objects and names to satoshis, with tokens backed one unit per satoshi.`,
    actions: ['mint', 'transfer', 'claim'],
  },
  'OP DATA': {
    summary: $localize`:@@universe.copy.family-op-data:These protocols carry their instructions in a transaction's data output, which every node relays but none interprets.`,
    actions: ['deploy', 'mint', 'transfer'],
  },
  OTHER: {
    summary: $localize`:@@universe.copy.family-other:A metaprotocol on Bitcoin: rules layered on top of ordinary transactions and enforced by an indexer, not by consensus.`,
    actions: ['deploy', 'mint', 'transfer'],
  },
};

const PROTOCOL_COPY: Record<string, ProtocolCopy> = {
  ordinals: {
    summary: $localize`:@@universe.copy.ordinals:Ordinal theory numbers every satoshi in the order it was mined, which makes individual satoshis trackable. An inscription attaches content to one of them, so images, text, and other files live directly in Bitcoin's witness data.`,
    actions: ['inscribe', 'reveal', 'transfer'],
    howToRead: $localize`:@@universe.copy.ordinals-read:An inscription sits on a specific output. The transaction view names the output that carries it before and after the spend, so a transfer is visible as a move between outpoints rather than inferred from the transaction shape.`,
  },
  rare_sats: {
    summary: $localize`:@@universe.copy.rare-sats:Rare satoshis are the individual satoshis that open a block, a difficulty adjustment, a halving, or a cycle. Their rarity comes from Bitcoin's own schedule, not from any issuer.`,
    actions: ['transfer'],
    howToRead: $localize`:@@universe.copy.rare-sats-read:The explorer lists notable satoshis by their ordinal number and rarity on the output that holds them. Rarity is derived from the satoshi's position in Bitcoin's issuance schedule and can be recomputed by anyone.`,
  },
  runes: {
    summary: $localize`:@@universe.copy.runes:Runes are fungible tokens native to Bitcoin. A rune is etched once, minted according to the terms set at etching, and moved by edicts written into a transaction's data output. Balances live on unspent outputs, so a rune transfer is an ordinary bitcoin spend with instructions attached.`,
    actions: ['etch', 'mint', 'transfer', 'burn'],
    howToRead: $localize`:@@universe.copy.runes-read:Each output shows the rune balances the authority proves it holds, as exact whole numbers. Amounts are never converted through floating point, so large supplies stay precise.`,
  },
  brc20: {
    summary: $localize`:@@universe.copy.brc20:BRC-20 is a token standard written as JSON inside ordinal inscriptions. Deploys, mints, and transfers are ordinary inscriptions whose text an indexer interprets as ledger operations.`,
    actions: ['deploy', 'mint', 'transfer'],
  },
  stamps: {
    summary: $localize`:@@universe.copy.stamps:Bitcoin Stamps encode image data into outputs that cannot be pruned from the UTXO set, which makes the content unusually durable at a higher cost per byte than an inscription.`,
    actions: ['stamp', 'transfer'],
  },
  src20: {
    summary: $localize`:@@universe.copy.src20:SRC-20 is a token standard built on Bitcoin Stamps, with deploy, mint, and transfer instructions carried in stamp data.`,
    actions: ['deploy', 'mint', 'transfer'],
  },
  alkanes: {
    summary: $localize`:@@universe.copy.alkanes:Alkanes runs WebAssembly contracts against Bitcoin outputs. Contract state is derived by an indexer replaying the chain, so results are reproducible from Bitcoin data alone.`,
    actions: ['deploy', 'call', 'transfer'],
  },
  arc20: {
    summary: $localize`:@@universe.copy.arc20:ARC-20 tokens are backed one unit per satoshi, so moving the token means moving the exact satoshis that carry it.`,
    actions: ['mint', 'transfer'],
  },
  atomicals_nft: {
    summary: $localize`:@@universe.copy.atomicals-nft:Atomicals NFTs are digital objects minted onto individual satoshis under the Atomicals rules.`,
    actions: ['mint', 'transfer'],
  },
  realms: {
    summary: $localize`:@@universe.copy.realms:Realms are Atomicals names claimed without a suffix, written with a leading plus sign. They act as on-chain identities.`,
    actions: ['claim', 'transfer'],
  },
  bitmap: {
    summary: $localize`:@@universe.copy.bitmap:Bitmap claims a Bitcoin block as a numbered district by inscribing its height, turning the block sequence into a scarce namespace.`,
    actions: ['claim', 'transfer'],
  },
  tap: {
    summary: $localize`:@@universe.copy.tap:TAP extends inscription-based token rules with authority and multi-step operations, including transfers signed by a privileged key.`,
    actions: ['deploy', 'mint', 'transfer'],
  },
  dmt: {
    summary: $localize`:@@universe.copy.dmt:Digital Matter Theory derives assets from patterns already present in Bitcoin block data, so issuance follows the chain rather than an arbitrary decision.`,
    actions: ['deploy', 'mint'],
  },
  op_return: {
    summary: $localize`:@@universe.copy.op-return:Protocols in this group write their instructions into a transaction's data output. Bitcoin Core relays that data without interpreting it, so meaning comes entirely from the indexer that reads it.`,
    actions: ['deploy', 'mint', 'transfer'],
  },
  doginals: {
    summary: $localize`:@@universe.copy.doginals:Doginals apply ordinal theory to Dogecoin: content inscribed on individual koinu and carried by the unspent output that holds them.`,
    actions: ['inscribe', 'transfer'],
  },
  drc20: {
    summary: $localize`:@@universe.copy.drc20:DRC-20 is the Dogecoin counterpart of inscription-based fungible tokens. Balances belong to an address; a transfer inscription moves an amount onto one unspent output until it is spent.`,
    actions: ['deploy', 'mint', 'transfer'],
  },
  dunes: {
    summary: $localize`:@@universe.copy.dunes:Dunes are Dogecoin's runestone-style fungible tokens: balances live directly on unspent outputs and move by edicts in the spending transaction.`,
    actions: ['etch', 'mint', 'transfer'],
  },
  tap_doge: {
    summary: $localize`:@@universe.copy.tap-doge:TAP on Dogecoin keeps token balances in an address-level ledger derived from inscriptions, so holdings belong to the address rather than to any single output.`,
    actions: ['deploy', 'mint', 'transfer'],
  },
  zerdinals: {
    summary: $localize`:@@universe.copy.zerdinals:Zerdinals inscribe content into Zcash transparent transactions, and each inscription is carried by the unspent output that currently holds it.`,
    actions: ['inscribe', 'transfer'],
  },
  zrunes: {
    summary: $localize`:@@universe.copy.zrunes:ZRunes are Zcash's runestone-style fungible tokens: balances live on transparent unspent outputs and move by edicts in the spending transaction.`,
    actions: ['etch', 'mint', 'transfer'],
  },
  zrc20: {
    summary: $localize`:@@universe.copy.zrc20:ZRC-20 tokens keep an address-level ledger on Zcash, read under two published rulesets. Where the rulesets disagree this explorer shows both readings.`,
    actions: ['deploy', 'mint', 'transfer'],
  },
};

/** Copy for one protocol, falling back to its family and then to a generic line. */
export function protocolCopy(protocolId: string, family: string): ProtocolCopy {
  const exact = PROTOCOL_COPY[protocolId];
  if (exact) {return exact;}
  const normalized = (family || 'OTHER').toUpperCase().replace(/[_-]+/g, ' ').trim();
  return FAMILY_COPY[normalized] ?? FAMILY_COPY.OTHER;
}
