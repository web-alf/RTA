import { createContext, useCallback, useContext, useState, ReactNode } from 'react';
type T = { id: number; text: string; kind: 'success' | 'danger' };
const Ctx = createContext<(text: string, kind?: 'success' | 'danger') => void>(() => {});
export const useToast = () => useContext(Ctx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<T[]>([]);
  const push = useCallback((text: string, kind: 'success' | 'danger' = 'success') => {
    const id = Date.now(); setItems((s) => [...s, { id, text, kind }]); setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 4000);
  }, []);
  return (
    <Ctx.Provider value={push}>{children}
      <div className="fixed bottom-28 md:bottom-auto md:top-5 inset-x-4 md:inset-x-auto md:right-5 z-[60] space-y-2 md:w-96" aria-live="polite">
        {items.map((t) => <div key={t.id} className={`px-4 py-3 rounded-2xl text-sm font-semibold shadow-float ${t.kind === "success" ? "bg-success text-white" : "bg-danger text-white"}`}>{t.text}</div>)}
      </div>
    </Ctx.Provider>
  );
}
