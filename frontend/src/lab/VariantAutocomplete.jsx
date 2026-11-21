// Genetics variant picker (Section 6.2): technicians pick a known ClinVar
// variant rather than free-typing. Loads the gene's table from
// /api/reference/variants/:gene and filters on cDNA / protein as you type.
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

const CLASS_STYLE = {
  pathogenic: 'text-danger-fg',
  likely_pathogenic: 'text-high-fg',
  vus: 'text-fg-3',
};

export default function VariantAutocomplete({ gene, value, onPick }) {
  const [all, setAll] = useState(null);
  const [query, setQuery] = useState(value?.variant ?? '');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(null);
  const boxRef = useRef(null);

  useEffect(() => {
    setAll(null);
    setError(null);
    if (!gene) return;
    let live = true;
    api
      .variantsFor(gene)
      .then((d) => live && setAll(d.variants))
      .catch(() => live && setError('No variant table for this gene'));
    return () => {
      live = false;
    };
  }, [gene]);

  useEffect(() => {
    const onDocClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const q = query.trim().toLowerCase();
  const matches = !all
    ? []
    : (q
        ? all.filter((v) => v.c.toLowerCase().includes(q) || v.p.toLowerCase().includes(q))
        : all
      ).slice(0, 30);

  return (
    <div ref={boxRef} className="relative">
      <input
        value={query}
        disabled={!gene}
        placeholder={gene ? 'Type cDNA (c.1226A>G) or protein' : 'Choose a gene first'}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          onPick({ variant: e.target.value, classification: value?.classification });
        }}
        onFocus={() => setOpen(true)}
        className="w-full rounded-md border border-line-strong px-2 py-1.5 text-sm focus:border-line-strong focus:outline-none disabled:bg-subtle"
      />
      {error && <p className="mt-1 text-[11px] text-warn-fg">{error} — you can still type the variant manually.</p>}
      {open && matches.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-line bg-surface text-sm shadow-lg">
          {matches.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                onClick={() => {
                  setQuery(v.c);
                  setOpen(false);
                  onPick({ variant: v.c, protein: v.p, classification: v.cls, variation_id: v.id });
                }}
                className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left hover:bg-subtle"
              >
                <span>
                  <span className="font-mono">{v.c}</span>
                  {v.p && <span className="ml-2 text-fg-3">{v.p}</span>}
                </span>
                <span className={`text-[11px] ${CLASS_STYLE[v.cls] ?? 'text-fg-3'}`}>{v.cls.replace('_', ' ')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {all && (
        <p className="mt-1 text-[11px] text-fg-3">{all.length.toLocaleString()} known pathogenic / likely-pathogenic {gene} variants (ClinVar)</p>
      )}
    </div>
  );
}
