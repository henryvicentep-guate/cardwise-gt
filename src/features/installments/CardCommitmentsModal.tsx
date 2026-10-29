import { useEffect, useRef, useState } from 'react';
import { Plus, TriangleAlert, X } from 'lucide-react';
import type { CreditCardAccount } from '../cards/types';
import type { InstallmentPlan } from './types';
import { isInstallmentActive, summarizeInstallments } from './progress';
import { formatCurrency } from '../../lib/currency/formatCurrency';

type Props = {
  card: CreditCardAccount;
  installments: InstallmentPlan[];
  onClose: () => void;
  onSaveNotes: (notes: string, avoid: boolean) => void;
  onAdd: () => void;
  onEdit: (plan: InstallmentPlan) => void;
  onSettle: (id: string) => void;
  onRemove: (id: string) => void;
};

export function CardCommitmentsModal({ card, installments, onClose, onSaveNotes, onAdd, onEdit, onSettle, onRemove }: Props) {
  const [notes, setNotes] = useState(card.notes ?? '');
  const [avoid, setAvoid] = useState(card.avoidNewInstallments ?? false);
  const [saved, setSaved] = useState(false);
  const [action, setAction] = useState<{ plan: InstallmentPlan; kind: 'settle' | 'remove' } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => { element?.close(); previous?.focus(); };
  }, []);
  const active = installments.filter(isInstallmentActive);
  const history = installments.filter((plan) => !isInstallmentActive(plan));
  const dirty = notes !== (card.notes ?? '') || avoid !== (card.avoidNewInstallments ?? false);
  function close() {
    if (dirty && !window.confirm('Tienes notas o una advertencia sin guardar. ¿Cerrar y descartar esos cambios?')) return;
    onClose();
  }
  function beforeEditor(callback: () => void) {
    if (dirty) onSaveNotes(notes.trim(), avoid);
    callback();
  }
  return (
    <dialog ref={dialog} className="commitments-dialog m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl rounded-xl bg-white p-0 text-slate-950 shadow-2xl" aria-labelledby="commitments-title" onCancel={(event) => { event.preventDefault(); close(); }}>
      <div className="flex items-start justify-between gap-3 border-b p-4">
        <div><h2 id="commitments-title" className="text-lg font-bold">Notas y cuotas</h2><p className="text-sm text-slate-500">{card.alias}</p></div>
        <button autoFocus onClick={close} aria-label="Cerrar notas y cuotas" className="grid size-11 place-items-center rounded-lg bg-slate-100"><X size={20} /></button>
      </div>
      <div className="space-y-5 p-4">
        <div className="grid gap-2">
          {summarizeInstallments(installments).map((total) => <div key={total.currency} className="flex flex-wrap justify-between gap-3 rounded-lg bg-teal-50 p-3 text-teal-950"><div><p className="text-xs">Saldo en cuotas · {total.currency}</p><p className="text-xl font-bold">{formatCurrency(total.pending, total.currency)}</p></div><div className="text-right"><p className="text-xs">Cuota mensual</p><p className="text-lg font-bold">{formatCurrency(total.monthly, total.currency)}</p></div></div>)}
        </div>
        <section>
          <label className={`flex cursor-pointer items-start gap-3 rounded-lg border-2 p-3 text-sm font-semibold ${avoid ? 'border-red-700 bg-red-50 text-red-800' : 'border-slate-200'}`}>
            <input type="checkbox" checked={avoid} onChange={(event) => { setAvoid(event.target.checked); setSaved(false); }} className="mt-1 size-5 shrink-0 accent-red-700" />
            <span><span className="flex items-center gap-2"><TriangleAlert size={18} />Evitar nuevas cuotas en esta tarjeta</span><span className="mt-1 block text-xs font-normal">Activa una advertencia roja en la ficha de esta tarjeta.</span></span>
          </label>
          <label className="mt-3 grid gap-1 text-sm font-semibold">Notas antes de usar esta tarjeta<textarea rows={3} className="w-full rounded-lg border border-slate-300 p-3 text-base font-normal" placeholder="Ej.: Estoy pagando el carro de mi hijo. Evitar otro financiamiento." value={notes} onChange={(event) => { setNotes(event.target.value); setSaved(false); }} /></label>
          <button onClick={() => { onSaveNotes(notes.trim(), avoid); setNotes(notes.trim()); setSaved(true); }} className="mt-2 min-h-11 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white">Guardar notas y advertencia</button>
          <span role="status" className="ml-2 text-sm text-teal-700">{saved ? 'Guardado' : dirty ? 'Sin guardar' : ''}</span>
        </section>
        <section>
          <div className="flex items-center justify-between gap-2"><h3 className="font-bold">Financiamientos activos</h3><button onClick={() => beforeEditor(onAdd)} className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-teal-700 px-3 text-sm font-semibold text-white"><Plus size={16} />Agregar</button></div>
          {active.length ? <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-100 text-xs text-slate-600"><tr><th className="p-2">Descripción del gasto</th><th className="p-2">Monto de la cuota</th><th className="p-2">Cuotas pendientes</th><th className="p-2">Total pendiente</th></tr></thead><tbody>{active.map((plan) => {
            const remaining = Math.max(plan.totalInstallments - plan.paidInstallments, 0);
            return <tr key={plan.id} className="border-b"><td className="p-2"><strong className="break-words">{plan.description}</strong><div className="mt-2 flex flex-wrap gap-2 text-xs"><button className="min-h-9 font-semibold text-teal-800 underline" onClick={() => beforeEditor(() => onEdit(plan))}>Editar</button><button className="min-h-9 font-semibold text-teal-800 underline" onClick={() => setAction({ plan, kind: 'settle' })}>Liquidar</button><button className="min-h-9 font-semibold text-red-700 underline" onClick={() => setAction({ plan, kind: 'remove' })}>Eliminar</button></div></td><td className="p-2">{formatCurrency(plan.monthlyPayment, plan.currency)}</td><td className="p-2 font-bold">{remaining}</td><td className="p-2">{formatCurrency(Math.round(plan.monthlyPayment * 100) * remaining / 100, plan.currency)}</td></tr>;
          })}</tbody></table></div> : <p className="mt-3 rounded-lg border border-dashed p-4 text-sm text-slate-500">Sin financiamientos activos. Puedes registrar cuotas pendientes sin conocer la fecha de inicio.</p>}
          <p className="mt-3 text-xs leading-relaxed text-slate-500">Se descuenta una cuota en cada corte, incluyendo los cortes transcurridos sin abrir la app. Este avance no registra un abono al estado de cuenta. Próximo corte: día {card.cutDay}. {active.some((plan) => plan.lastAppliedCutDate) ? `Último corte revisado: ${active.map((plan) => plan.lastAppliedCutDate ?? '').sort().at(-1)}.` : ''}</p>
        </section>
        {action ? <section role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm"><p className="font-semibold">¿{action.kind === 'settle' ? 'Liquidar' : 'Eliminar'} «{action.plan.description}»?</p><p className="mt-1">Saldrá del saldo en cuotas y se conservará en el historial como {action.kind === 'settle' ? 'liquidado anticipadamente' : 'eliminado'}. No modifica el saldo del estado de cuenta.</p><div className="mt-3 flex gap-3"><button className="min-h-11 rounded-lg bg-red-700 px-3 font-semibold text-white" onClick={() => { (action.kind === 'settle' ? onSettle : onRemove)(action.plan.id); setAction(null); }}>Confirmar</button><button className="min-h-11 px-3 font-semibold" onClick={() => setAction(null)}>Cancelar</button></div></section> : null}
        <details><summary className="min-h-11 cursor-pointer py-2 font-bold">Historial ({history.length})</summary><div className="space-y-2">{history.length === 0 ? <p className="text-sm text-slate-500">Aún no hay financiamientos finalizados.</p> : history.map((plan) => <article key={plan.id} className="rounded-lg bg-slate-100 p-3 text-sm"><p className="font-semibold">{plan.description}</p><p>{plan.closureReason === 'removed' ? 'Eliminado' : plan.closureReason === 'settled' ? 'Liquidado anticipadamente' : plan.paidInstallments >= plan.totalInstallments ? 'Completado' : 'Cerrado'}{plan.closedAt ? ` · ${new Date(plan.closedAt).toLocaleDateString('es-GT')}` : ''}</p><p className="text-slate-600">Cuota: {formatCurrency(plan.monthlyPayment, plan.currency)} · Cuotas al finalizar: {Math.max(plan.totalInstallments - plan.paidInstallments, 0)}</p></article>)}</div></details>
      </div>
    </dialog>
  );
}
