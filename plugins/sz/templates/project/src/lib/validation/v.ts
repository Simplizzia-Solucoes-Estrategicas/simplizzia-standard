import { z } from 'zod';

// The only place (with src/lib/env.ts) that imports zod. Defaults are strict on purpose:
// strings are trimmed and required unless the schema says otherwise.

const onlyDigits = (value: string): string => value.replace(/\D/g, '');

// Since July 2026 new CNPJs may contain letters in the first 12 positions. Each character is
// worth its ASCII code minus 48, which keeps the old numeric CNPJs valid.
const normalizeCnpj = (value: string): string => value.toUpperCase().replace(/[^0-9A-Z]/g, '');

// Character value = ASCII code minus 48: '0'..'9' keep their digit value, 'A' is 17 (CNPJ rule).
function characterValues(value: string): number[] {
  return Array.from({ length: value.length }, (_, index) => value.charCodeAt(index) - 48);
}

function checkDigit(values: number[], weights: number[]): number {
  const sum = weights.reduce((total, weight, index) => total + weight * (values[index] ?? 0), 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

function isValidCpf(value: string): boolean {
  if (!/^\d{11}$/.test(value) || /^(\d)\1{10}$/.test(value)) return false;
  const digits = characterValues(value);
  const first = checkDigit(digits, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(digits, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return first === digits[9] && second === digits[10];
}

function isValidCnpj(value: string): boolean {
  if (!/^[0-9A-Z]{12}\d{2}$/.test(value) || /^(\w)\1{13}$/.test(value)) return false;
  const values = characterValues(value);
  const first = checkDigit(values, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(values, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return first === values[12] && second === values[13];
}

export const v = {
  string: () => z.string().trim().min(1, 'Campo obrigatório'),
  optionalString: () => z.string().trim().optional(),
  email: () => z.string().trim().toLowerCase().pipe(z.email('E-mail inválido')),
  cpf: () => z.string().transform(onlyDigits).refine(isValidCpf, 'CPF inválido'),
  cnpj: () => z.string().transform(normalizeCnpj).refine(isValidCnpj, 'CNPJ inválido'),
  cep: () => z.string().transform(onlyDigits).refine((value) => value.length === 8, 'CEP inválido'),
  phone: () =>
    z.string().transform(onlyDigits).refine((value) => value.length === 10 || value.length === 11, 'Telefone inválido'),
  id: () => z.uuid('Identificador inválido'),
  number: () => z.coerce.number(),
  boolean: () => z.boolean(),
  object: z.object,
  array: z.array,
  enum: z.enum,
  literal: z.literal,
  unknown: z.unknown,
};

// Input is what the form holds; Output is what the server receives after parsing.
export type Input<Schema extends z.ZodType> = z.input<Schema>;
export type Output<Schema extends z.ZodType> = z.output<Schema>;
