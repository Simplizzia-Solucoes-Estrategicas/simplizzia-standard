import { listCustomers } from '@/data/customers/queries';
import { CustomerForm } from '@/screens/Customers/CustomerForm';
import { CustomerList } from '@/screens/Customers/CustomerList';

// Server Component: reads straight from src/data, no fetch to our own API.
export async function CustomersScreen() {
  const customers = await listCustomers();
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 p-6">
      <h1 className="text-2xl font-semibold">Clientes</h1>
      <CustomerForm />
      <CustomerList customers={customers} />
    </main>
  );
}
