# Migracion RADIUS por lotes

Este procedimiento aplica solamente al RB4011 de fibra con PPPoE. Los clientes
del RB750 usan Simple Queues/IP y siguen bajo control del worker.

## Arquitectura objetivo

1. Supabase conserva clientes, pagos, vencimientos y estados.
2. El panel crea recargas y acciones pendientes.
3. El worker de la VPS procesa esas acciones.
4. FreeRADIUS autentica PPPoE y entrega velocidad/perfil.
5. El RB4011 consulta RADIUS por WireGuard.

Las credenciales PPPoE se guardan solamente en el almacenamiento protegido de
RADIUS en la VPS. No deben guardarse en Git, capturas, registros ni Supabase de
acceso publico.

## Preparacion obligatoria

- Cambiar los secretos y contrasenas que fueron compartidos anteriormente.
- Configurar acceso SSH por clave y desactivar el uso operativo de contrasenas
  compartidas.
- Respaldar la configuracion de FreeRADIUS, el worker y su archivo de entorno.
- Guardar un export del RB4011 antes de escribir.
- Confirmar que `prueba` autentica con bandera `R`, recibe su velocidad, se
  corta al vencer y vuelve a conectar despues de una recarga.
- Mantener habilitados los Secrets locales de todos los clientes no migrados.

## Primer lote de cinco

El administrador debe elegir cinco usuarios PPPoE conocidos y disponibles para
pruebas. No se eligen clientes al azar.

Para cada usuario:

1. Comprobar que existe una sola vez en el RB4011, Supabase y RADIUS.
2. Comprobar su contrasena y su perfil sin mostrarlos en pantalla.
3. Probar la cuenta localmente con `radtest` desde la VPS.
4. Deshabilitar solamente su Secret local.
5. Desconectar solamente su sesion activa para forzar la autenticacion RADIUS.
6. Confirmar la bandera `R`, navegacion, IP y velocidad.
7. Probar corte y recarga con uno de los cinco usuarios bajo supervision.

No es necesario apagar todos los routers. Se reconecta solamente la sesion del
cliente que se esta migrando.

## Reversion individual

Si un cliente no autentica o recibe un perfil incorrecto:

1. Volver a habilitar solamente su PPP Secret local.
2. Desconectar solamente su sesion fallida.
3. Confirmar que vuelve a conectar mediante el Secret local.
4. Dejarlo fuera del lote hasta corregir la causa.

No se debe desactivar RADIUS globalmente si otros usuarios del lote ya dependen
de el.

## Criterios antes de ampliar

- Cinco de cinco usuarios conectan con bandera `R`.
- No hay rechazos, timeouts ni respuestas invalidas nuevos.
- Cada plan entrega la velocidad esperada.
- Accounting registra inicio, actualizaciones y cierre de sesion.
- El corte afecta solamente al usuario vencido.
- La recarga reactiva y permite reconectar.
- El worker y FreeRADIUS permanecen estables por al menos 24 horas.

Despues se puede continuar en lotes de 10. La migracion de todos en una sola
operacion solo se evalua cuando varios lotes hayan cumplido estos criterios.

## Fallas posibles

- Contrasena distinta: RADIUS responde `Access-Reject` y el cliente no conecta.
- Perfil mal mapeado: conecta con velocidad incorrecta.
- Secret local duplicado o habilitado: conecta localmente y no aparece `R`.
- Caida de WireGuard/VPS/RADIUS: las reconexiones RADIUS pueden fallar.
- Fecha incorrecta en Supabase: el worker puede cortar antes de tiempo.
- Desconexion masiva: provoca una interrupcion simultanea evitable.
- Falta de accounting: dificulta diagnosticar sesiones y consumo.

Por estas razones el paso de cinco clientes no debe convertirse inmediatamente
en una migracion total sin un periodo de observacion.
