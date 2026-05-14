import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import type { Realm } from "@/lib/api";

/** Searchable connected-realm picker — the realm list is long (one region can
 *  have 200+ connected realms), so a plain <Select> is unusable. */
export function RealmCombobox({
  realms,
  value,
  onChange,
}: {
  realms: Realm[] | null;
  value: number | null;
  onChange: (id: number) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  const selected = realms?.find(r => r.id === value) ?? null;

  const filtered = useMemo(() => {
    if (!realms) return [];
    const needle = q.trim().toLowerCase();
    const list = needle ? realms.filter(r => r.name.toLowerCase().includes(needle)) : realms;
    return list.slice(0, 200);
  }, [realms, q]);

  // close when clicking outside
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        disabled={!realms}
        className="border-input bg-transparent dark:bg-input/30 flex h-7 w-[280px] items-center justify-between gap-1.5 rounded-lg border px-2.5 text-xs whitespace-nowrap outline-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className={`truncate font-mono ${selected ? "" : "text-muted-foreground"}`}>
          {selected ? selected.name : realms ? t("app.selectRealm") : t("app.loadingRealms")}
        </span>
        <ChevronsUpDown className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
      </button>

      {open && realms && (
        <div className="bg-popover absolute z-50 mt-1 w-[320px] rounded-lg border shadow-md ring-1 ring-foreground/10">
          <div className="relative border-b p-1.5">
            <Search className="text-muted-foreground pointer-events-none absolute top-[15px] left-3 h-3.5 w-3.5" />
            <Input
              autoFocus
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder={t("app.searchRealm")}
              className="h-7 pl-7 font-mono text-xs"
            />
          </div>
          <div className="max-h-[320px] overflow-auto p-1">
            {filtered.map(r => (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  onChange(r.id);
                  setOpen(false);
                  setQ("");
                }}
                className="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs"
              >
                <Check className={`h-3.5 w-3.5 shrink-0 ${r.id === value ? "opacity-100" : "opacity-0"}`} />
                <span className="truncate font-mono">{r.name}</span>
                <span className="text-muted-foreground ml-auto text-[10px] uppercase">{r.population}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="text-muted-foreground p-3 text-center text-xs">{t("app.noRealm")}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
