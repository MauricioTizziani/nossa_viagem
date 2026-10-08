#!/usr/bin/env node
/** Local owner bootstrap/recovery only. No service secret enters the web app. */
import { mkdir, open, writeFile, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

const args = process.argv.slice(2);
const allowed = new Set(['--trip', '--output', '--help']);
const options = {};
for (let index = 0; index < args.length; index += 1) {
  const key = args[index];
  if (!allowed.has(key)) throw new Error(`Opção desconhecida: ${key}`);
  if (key === '--help') {
    console.log('Uso: node --env-file=.env.owner scripts/provision-owner.mjs [--trip UUID] [--output caminho]');
    console.log('Sem --trip: cria uma viagem vazia. Com --trip: recupera o acesso do proprietário à mesma viagem.');
    process.exit(0);
  }
  const value = args[++index];
  if (!value || value.startsWith('--') || options[key]) throw new Error(`Informe uma única vez o valor de ${key}.`);
  options[key] = value;
}

let reservedFile;
try {
  const endpoint = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  if (!endpoint || !secret) throw new Error('Configure SUPABASE_URL e SUPABASE_SECRET_KEY somente no ambiente local do proprietário (service_role legado também é aceito).');
  const supabaseUrl = new URL(endpoint);
  const link = new URL(appUrl);
  for (const url of [supabaseUrl, link]) {
    if (url.username || url.password || url.search || url.hash ||
        !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
      throw new Error('Use URLs HTTPS sem credenciais, consulta ou fragmento; HTTP apenas para localhost.');
    }
  }
  const tripId = options['--trip'] ?? null;
  if (tripId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tripId)) {
    throw new Error('--trip deve ser o UUID da viagem existente.');
  }

  const output = resolve(options['--output'] ?? '.private/owner-invite.txt');
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  // Reserve the output before calling the database, avoiding orphan invitations
  // if an existing file would otherwise be replaced without the owner's review.
  const handle = await open(output, 'wx', 0o600);
  await handle.close();
  reservedFile = output;

  const headers = { apikey: secret, 'Content-Type': 'application/json' };
  // Current sb_secret keys are not JWTs and must travel in apikey, not Bearer.
  if (!secret.startsWith('sb_secret_')) headers.Authorization = `Bearer ${secret}`;
  const response = await fetch(`${supabaseUrl.origin}${supabaseUrl.pathname.replace(/\/$/, '')}/rest/v1/rpc/provision_trip_owner`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ p_trip_id: tripId, p_name: 'Nossa Viagem' }),
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
  });
  // Never print request/response bodies: an unexpected body could contain secrets.
  if (!response.ok) throw new Error(`O procedimento não foi confirmado (HTTP ${response.status}). Confira a migração, a URL e a chave administrativa.`);
  const payload = await response.json();
  const result = Array.isArray(payload) ? payload[0] : payload;
  if (!result || !/^[0-9a-f]{64}$/.test(result.token ?? '') || !result.trip_id || !result.expires_at) {
    throw new Error('Resposta inesperada do procedimento; não foi possível preparar o convite.');
  }
  link.hash = `convite=${result.token}`;
  const contents = [
    'Nossa Viagem — convite privado do proprietário',
    `Viagem: ${result.trip_id}`,
    `Convite: ${result.invite_id}`,
    `Expira em: ${result.expires_at}`,
    'Abra o link abaixo em UM aparelho do proprietário. O link autoriza consultar e editar a viagem.',
    link.toString(),
    '',
    'Guarde o ID da viagem para recuperação. Apague este arquivo depois de abrir o convite.',
    'Não envie este arquivo a logs, repositórios, ferramentas de análise ou canais públicos.',
    '',
  ].join('\n');
  await writeFile(output, contents, { encoding: 'utf8', mode: 0o600 });
  reservedFile = undefined;
  console.log(tripId ? 'Convite de recuperação criado para a viagem existente.' : 'Viagem vazia criada. Nenhum nome, destino, data ou atividade foi inventado.');
  console.log(`ID da viagem: ${result.trip_id}`);
  console.log(`O link privado foi salvo apenas em: ${output}`);
  console.log('Abra o arquivo local, use o convite em um aparelho e depois apague o arquivo.');
} catch (error) {
  if (reservedFile) await unlink(reservedFile).catch(() => {});
  console.error(error instanceof Error ? error.message : 'Não foi possível provisionar o acesso.');
  process.exitCode = 1;
}
