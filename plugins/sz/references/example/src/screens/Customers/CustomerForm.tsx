'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useAction } from 'next-safe-action/hooks';
import { useForm } from 'react-hook-form';

import { createCustomer } from '@/data/customers/actions';
import { type CustomerFormValues, type CustomerInput, customerInputSchema } from '@/data/customers/schema';

export function CustomerForm() {
  const form = useForm<CustomerFormValues, unknown, CustomerInput>({
    resolver: zodResolver(customerInputSchema),
    defaultValues: { name: '', cpf: '' },
  });
  const { execute, isPending, result } = useAction(createCustomer, {
    onSuccess: () => {
      form.reset();
    },
  });
  const { errors } = form.formState;

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        void form.handleSubmit((values) => {
          execute(values);
        })(event);
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Nome</span>
        <input className="rounded-md border px-3 py-2" {...form.register('name')} />
        {errors.name !== undefined && <span className="text-sm text-destructive">{errors.name.message}</span>}
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">CPF</span>
        <input className="rounded-md border px-3 py-2" inputMode="numeric" {...form.register('cpf')} />
        {errors.cpf !== undefined && <span className="text-sm text-destructive">{errors.cpf.message}</span>}
      </label>
      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
      >
        {isPending ? 'Salvando…' : 'Salvar'}
      </button>
      {result.serverError !== undefined && (
        <p role="alert" className="text-sm text-destructive">
          {result.serverError}
        </p>
      )}
    </form>
  );
}
