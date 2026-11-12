import { useQuery } from '@tanstack/react-query';
import { get, tgl } from '../lib/api';
import { Empty, PageHeader } from '../components/ui';

export function Audit() {
  const q = useQuery({ queryKey: ['audit'], queryFn: () => get('/audit') });
  return (
    <div><PageHeader title="Audit log" />
      <div className="card overflow-x-auto"><table className="w-full min-w-[720px]"><thead><tr><th className="th">Waktu</th><th className="th">Oleh</th><th className="th">Aksi</th><th className="th">Data</th><th className="th">Perubahan</th></tr></thead>
        <tbody>{q.data?.map((a: any) => <tr key={a.id}><td className="td whitespace-nowrap">{new Date(a.createdAt).toLocaleString('id-ID')}</td><td className="td">{a.actor ?? 'sistem'}</td><td className="td">{a.action}</td><td className="td">{a.entity} #{a.entityId ?? '-'}</td>
          <td className="td"><details className="text-xs"><summary className="cursor-pointer text-brand-700">lihat</summary><pre className="whitespace-pre-wrap max-w-md">{JSON.stringify({ lama: a.oldValue, baru: a.newValue }, null, 1)}</pre></details></td></tr>)}</tbody></table>
        {q.data && !q.data.length && <Empty text="Belum ada catatan." />}</div></div>
  );
}
