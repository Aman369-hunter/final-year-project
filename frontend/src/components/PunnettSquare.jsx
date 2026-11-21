// Punnett square from `inheritance` (Section 3.1). Percentages come from the
// response; the grid illustrates the cross they describe.
import { pct } from '../lib/risk.js';

const KIND = {
  affected: 'bg-danger-bg text-danger-fg ring-danger-line',
  carrier: 'bg-warn-bg text-warn-fg ring-warn-line',
  unaffected: 'bg-ok-bg text-ok-fg ring-ok-line',
};

// Carrier × carrier, autosomal recessive.
const AR = {
  mother: ['A', 'a'],
  father: ['A', 'a'],
  cell: (m, f) => {
    const g = [m, f].sort().join('');
    const kind = g === 'aa' ? 'affected' : g === 'AA' ? 'unaffected' : 'carrier';
    return { genotype: g, kind, label: { affected: 'Affected', carrier: 'Carrier', unaffected: 'Unaffected' }[kind] };
  },
  legend: 'A = typical allele · a = pathogenic allele',
};

// Heterozygous mother × unaffected father, X-linked.
const XL = {
  mother: ['Xᴬ', 'Xᵃ'],
  father: ['Xᴬ', 'Y'],
  cell: (m, f) => {
    const son = f === 'Y';
    const hasVariant = m === 'Xᵃ';
    if (son) return { genotype: `${m}Y`, kind: hasVariant ? 'affected' : 'unaffected', label: hasVariant ? 'Affected son' : 'Unaffected son' };
    return {
      genotype: `${m}${f}`,
      kind: hasVariant ? 'carrier' : 'unaffected',
      label: hasVariant ? 'Heterozygous daughter (often symptomatic)' : 'Unaffected daughter',
    };
  },
  legend: 'Xᵃ = X chromosome with the pathogenic variant',
};

export default function PunnettSquare({ inheritance }) {
  if (!inheritance?.applicable || !inheritance.punnett) {
    return (
      <div className="space-y-2">
        <p className="rounded-lg bg-subtle px-3 py-2 text-sm text-fg-2">Not assessed for this case.</p>
        {inheritance?.note && <p className="text-sm text-fg-2">{inheritance.note}</p>}
      </div>
    );
  }
  const model = inheritance.mode === 'x_linked' ? XL : AR;
  const p = inheritance.punnett;

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium uppercase tracking-wide text-fg-3">
        {inheritance.mode === 'x_linked' ? 'X-linked' : 'Autosomal recessive'}
      </p>
      <div className="grid grid-cols-[auto_1fr_1fr] gap-1.5 text-center text-xs">
        <div className="flex items-end justify-end p-1 text-[10px] text-fg-3">♀ \ ♂</div>
        {model.father.map((f) => (
          <div key={f} className="rounded bg-muted py-1 font-mono font-semibold text-fg-2">{f}</div>
        ))}
        {model.mother.map((m) => (
          <div key={m} className="contents">
            <div className="flex items-center rounded bg-muted px-2 font-mono font-semibold text-fg-2">{m}</div>
            {model.father.map((f) => {
              const c = model.cell(m, f);
              return (
                <div key={f} className={`rounded-md px-1 py-2 ring-1 ring-inset ${KIND[c.kind]}`}>
                  <div className="font-mono font-semibold">{c.genotype}</div>
                  <div className="mt-0.5 text-[10px] leading-tight">{c.label}</div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <p className="text-[11px] text-fg-3">{model.legend}</p>
      <dl className="grid grid-cols-3 gap-2 text-center">
        {[['Affected', p.affected_pct, 'affected'], ['Carrier', p.carrier_pct, 'carrier'], ['Unaffected', p.unaffected_pct, 'unaffected']].map(([label, v, kind]) => (
          <div key={label} className={`rounded-md py-1.5 ring-1 ring-inset ${KIND[kind]}`}>
            <dt className="text-[10px] uppercase tracking-wide">{label}</dt>
            <dd className="font-semibold tabular-nums">{pct(v / 100, 0)}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-fg-2">{inheritance.note}</p>
    </div>
  );
}
