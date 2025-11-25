import { useEffect, useMemo, useState } from 'react';

export interface DexSpeciesEntry {
  num: number;
  name: string;
  spriteId: string;
  baseSpecies?: string;
  forme?: string;
  baseForme?: string;
  abilities: string[];
  defaultItem?: string;
  defaultAbility?: string;
  moves: string[];
  defaultMoves: string[];
  defaultNature: string;
  defaultLevel: number;
  defaultGender: 'M' | 'F' | 'N' | '';
  defaultEvs: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
  defaultIvs: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
  availableGenders: Array<'M' | 'F' | 'N'>;
}

export interface DexCatalogPayload {
  species: DexSpeciesEntry[];
  items: string[];
  abilities: string[];
  moves: string[];
}

export interface DexCatalogState extends DexCatalogPayload {
  speciesMap: Record<string, DexSpeciesEntry>;
}

export function useDexCatalog() {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [catalog, setCatalog] = useState<DexCatalogState | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/catalog');
        if (!response.ok) throw new Error('Catalog unavailable (' + response.status + ')');
        const data = (await response.json()) as DexCatalogPayload;
        if (cancelled) return;
        const speciesMap: Record<string, DexSpeciesEntry> = {};
        for (const entry of data.species) {
          speciesMap[entry.name.toLowerCase()] = entry;
        }
        setCatalog({ ...data, speciesMap });
        setStatus('ready');
      } catch (error) {
        if (cancelled) return;
        console.error(error);
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const speciesOptions = useMemo(() => (
    catalog ? catalog.species.map(entry => ({ value: entry.name, label: entry.name })) : []
  ), [catalog]);

  return { catalog, status, speciesOptions } as const;
}
