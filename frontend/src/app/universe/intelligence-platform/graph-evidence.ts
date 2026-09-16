const TXID = /^[0-9a-f]{64}$/;
const amount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 2100000000000000;
export function normalizedEntity(value: string): string | null {
  const text = value.trim();
  return /^[0-9a-fA-F]{64}$/.test(text) ? text.toLowerCase() : /^[A-Za-z0-9]{14,120}$/.test(text) ? text : null;
}
function edgeValid(edge: any): boolean {
  return !!edge && typeof edge.source_id === 'string' && typeof edge.target_id === 'string' && amount(edge.value_sats) &&
    Number.isSafeInteger(edge.vout) && edge.vout >= 0 && ['input','output','replacement'].includes(edge.edge_type);
}
export function checkedGraph(value: any, root: string, network: string, hops: number, direction: string): any {
  if (!value || value.root_entity !== root || value.network !== network || value.hops !== hops || value.direction !== direction ||
    !Array.isArray(value.nodes) || !Array.isArray(value.edges) || value.nodes.length > 200 ||
    typeof value.truncated !== 'boolean' || ![null,'node_limit','fetch_budget','address_page'].includes(value.truncation_reason) ||
    value.truncated !== (value.truncation_reason !== null) || value.total_nodes_count !== value.nodes.length ||
    value.nodes.some((node: any) => !node || typeof node.id !== 'string' || !normalizedEntity(node.id) ||
      !['transaction','outpoint','address'].includes(node.type) || !(node.value_sats === null || amount(node.value_sats)) ||
      !['confirmed','mempool','replaced','conflicted','unknown'].includes(node.status) || !Number.isSafeInteger(node.depth) || node.depth < 0 || node.depth > hops) ||
    value.edges.some((edge: any) => !edgeValid(edge))) {throw new Error('Invalid graph evidence');}
  const ids = new Set(value.nodes.map((node: any) => node.id));
  if (ids.size !== value.nodes.length || !ids.has(root) || value.edges.some((edge: any) => !ids.has(edge.source_id) || !ids.has(edge.target_id))) {throw new Error('Unbound graph relationships');}
  return value;
}
export function checkedPath(value: any, from: string, to: string, network: string): any {
  if (!value || value.from_entity !== from || value.to_entity !== to || value.network !== network || typeof value.path_found !== 'boolean' ||
    typeof value.search_exhausted !== 'boolean' || value.total_value_transferred_sats !== null ||
    typeof value.transfer_scope !== 'string' || !Array.isArray(value.node_sequence) || !Array.isArray(value.edge_sequence) ||
    value.node_sequence.some((id: unknown) => typeof id !== 'string' || !TXID.test(id)) || value.edge_sequence.some((edge: any) => !edgeValid(edge)) ||
    !Number.isSafeInteger(value.total_hops) || value.total_hops < 0 || value.total_hops > 4 ||
    !(value.value_upper_bound_sats === null || amount(value.value_upper_bound_sats))) {throw new Error('Invalid path evidence');}
  if (value.path_found) {
    if (value.search_exhausted || value.node_sequence.length !== value.edge_sequence.length + 1 || value.total_hops !== value.edge_sequence.length ||
      value.node_sequence[0] !== from || value.node_sequence.at(-1) !== to ||
      value.edge_sequence.some((edge: any, index: number) => edge.source_id !== value.node_sequence[index] || edge.target_id !== value.node_sequence[index+1]) ||
      value.value_upper_bound_sats !== (value.edge_sequence.length ? Math.min(...value.edge_sequence.map((edge: any) => edge.value_sats)) : null)) {throw new Error('Unbound path evidence');}
  } else if (value.node_sequence.length || value.edge_sequence.length || value.total_hops !== 0 || value.value_upper_bound_sats !== null) {throw new Error('Unexpected path content');}
  return value;
}
