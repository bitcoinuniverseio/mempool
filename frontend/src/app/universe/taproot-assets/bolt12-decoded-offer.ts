export interface Bolt12DecodedOffer {
  status: 'decoded'; syntax_valid: true; engine: 'lightning-0.2.6'; network: string;
  input_sha256: string; offer_id: string; canonical_offer: string; tlv_hex: string;
  description: string | null; issuer: string | null; issuer_signing_pubkey: string | null;
  amount: null | {kind:'bitcoin';amount_msat:string} | {kind:'currency';currency:string;amount_minor_units:string};
  quantity: {kind:'one'|'unbounded'} | {kind:'bounded';maximum:string};
  absolute_expiry: string | null; expired: boolean; network_compatible: boolean; unknown_required_features: boolean;
  usable_for_invoice_request: boolean; chain_hashes_wire_order: string[]; blinded_path_count: number;
  signature_status:'not-applicable-unsigned-offer'; payment_verified:false; scope:string;
}

export function matchingOffer(value: Bolt12DecodedOffer, inputHash: string, network: string): boolean {
  const hash=(v:unknown):boolean=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
  const amount=(v:unknown):boolean=>typeof v==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(v)&&BigInt(v)<=18446744073709551615n;
  return !!value && value.status==='decoded' && value.syntax_valid===true && value.engine==='lightning-0.2.6'
    && value.network===network && value.input_sha256===inputHash && hash(value.offer_id)
    && typeof value.canonical_offer==='string' && value.canonical_offer.length<=16384 && value.canonical_offer.startsWith('lno1')
    && typeof value.tlv_hex==='string' && value.tlv_hex.length<=32768 && /^(?:[0-9a-f]{2})+$/.test(value.tlv_hex)
    && (value.amount===null || value.amount?.kind==='bitcoin'&&amount(value.amount.amount_msat)
      || value.amount?.kind==='currency'&&/^[A-Z]{3}$/.test(value.amount.currency)&&amount(value.amount.amount_minor_units))
    && [value.description,value.issuer].every(v=>v===null||typeof v==='string')
    && (value.absolute_expiry===null || amount(value.absolute_expiry))
    && [value.expired,value.network_compatible,value.unknown_required_features,value.usable_for_invoice_request].every(v=>typeof v==='boolean')
    && value.usable_for_invoice_request===(value.network_compatible&&!value.expired&&!value.unknown_required_features)
    && ['one','unbounded','bounded'].includes(value.quantity?.kind)
    && (value.quantity.kind!=='bounded'||amount(value.quantity.maximum)&&value.quantity.maximum!=='0')
    && Array.isArray(value.chain_hashes_wire_order)&&value.chain_hashes_wire_order.length>0&&value.chain_hashes_wire_order.every(hash)
    && Number.isSafeInteger(value.blinded_path_count)&&value.blinded_path_count>=0
    && value.signature_status==='not-applicable-unsigned-offer'&&value.payment_verified===false&&typeof value.scope==='string';
}
