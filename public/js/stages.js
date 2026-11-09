// Fases dos orçamentos e quem pode passar de uma para outra (usado no browser e no servidor).

export const STAGES = {
  pedido: { label: 'Pedido', hint: 'À espera do orçamento', cls: 'mute', icon: 'send' },
  por_decidir: { label: 'Por decidir', hint: 'Orçamento recebido', cls: 'warn', icon: 'file' },
  aprovado: { label: 'Aprovado', hint: 'Trabalho por fazer', cls: 'brand', icon: 'check-circle' },
  feito: { label: 'Feito', hint: 'Falta pagar', cls: 'violet', icon: 'wrench' },
  pago: { label: 'Pago', hint: 'Fatura paga', cls: 'done', icon: 'euro' },
  recusado: { label: 'Recusado', hint: 'Fora do circuito', cls: 'open', icon: 'x' },
};

// O circuito normal, por ordem; "recusado" fica de fora.
export const FLOW = ['pedido', 'por_decidir', 'aprovado', 'feito', 'pago'];
export const OPEN_STAGES = ['pedido', 'por_decidir', 'aprovado', 'feito'];
export const nextStage = s => FLOW.includes(s) ? FLOW[FLOW.indexOf(s) + 1] || null : null;

// A equipa só passa um pedido a "por decidir" (o orçamento chegou) e um aprovado a "feito".
// Aprovar, recusar, marcar como pago e corrigir a fase é com a administração.
export function canMove(isAdmin, from, to) {
  if (from === to || !STAGES[to]) return false;
  if (isAdmin) return true;
  return (from === 'pedido' && to === 'por_decidir') || (from === 'aprovado' && to === 'feito');
}

// Valor que conta nos gastos: o valor final da fatura ou, se não foi indicado, o valor orçado.
export const paidValue = q => q.final_amount ?? q.amount ?? 0;

// Ligação para o WhatsApp a partir de um telemóvel português (9xx xxx xxx) ou de um número internacional (+…).
export function whatsappNumber(phone) {
  const digits = String(phone || '').replace(/[^\d+]/g, '').replace(/^00/, '+');
  if (!digits) return null;
  if (digits.startsWith('+')) return digits.slice(1).replace(/\D/g, '') || null;
  const d = digits.replace(/\D/g, '');
  return /^9\d{8}$/.test(d) ? `351${d}` : null;
}
