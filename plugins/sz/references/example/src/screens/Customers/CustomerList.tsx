import type { CustomerListItem } from '@/data/customers/queries';
import { formatCpf } from '@/lib/format';

type CustomerListProps = { customers: CustomerListItem[] };

export function CustomerList({ customers }: CustomerListProps) {
  if (customers.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum cliente cadastrado ainda.</p>;
  }
  return (
    <ul className="divide-y rounded-md border">
      {customers.map((customer) => (
        <li key={customer.id} className="flex items-center justify-between px-4 py-3">
          <span>{customer.name}</span>
          <span className="text-sm text-muted-foreground">{formatCpf(customer.cpf)}</span>
        </li>
      ))}
    </ul>
  );
}
