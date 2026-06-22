# QR automatico y portal Mi servicio

## Estado seguro actual

La web ya tiene preparado:

- Consulta de cliente desde `/api/customer`.
- Boton `Pagar ahora con QR` en Mi servicio.
- Generacion de QR desde `/api/qr-create`.
- Webhook de confirmacion en `/api/qr-webhook`.
- Registro de pagos confirmados en Supabase.
- Suma automatica de `30 dias + 6 horas`.
- Creacion de accion pendiente en `router_actions`.

Importante: esta etapa no ejecuta cambios directos en MikroTik. El RB4011 y RB750 no se tocan hasta activar un worker seguro en la VPS.

## Variables necesarias en Vercel

Configura estas variables en Project Settings > Environment Variables:

```txt
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
PUBLIC_BASE_URL=https://TU-DOMINIO-O-VERCEL
QR_API_URL=
QR_API_TOKEN=
QR_WEBHOOK_SECRET=
```

`QR_WEBHOOK_SECRET` debe ser el mismo secreto que tu proveedor QR enviara en el header `X-Webhook-Secret`, si tu QR API permite configurarlo.

## SQL necesario

Ejecuta en Supabase, en este orden:

1. `supabase-schema.sql`
2. `supabase-security.sql`

## Flujo de pago

1. Cliente entra a Mi servicio.
2. Ingresa su carnet.
3. La web consulta `/api/customer`.
4. Cliente toca `Pagar ahora con QR`.
5. `/api/qr-create` crea pago pendiente y genera QR.
6. Cliente paga.
7. La QR API llama a `/api/qr-webhook`.
8. El webhook confirma pago, actualiza `paid_until` y crea accion `payment` pendiente.
9. La VPS procesara esa accion y activara PPPoE solo cuando el worker este listo y probado.

## Seguridad MikroTik

No activar procesamiento real con clientes reales hasta:

- Crear un cliente PPPoE de prueba en RB4011.
- Probar recarga con ese cliente.
- Confirmar que solo se ejecuta `enable` sobre ese usuario.
- Luego probar un corte manual controlado.
- Repetir lo mismo en RB750.

La tabla `router_actions` es la barrera de seguridad: la web nunca debe entrar directo al MikroTik.
