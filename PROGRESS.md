# PROGRESS — SintergiaSE APP
Fecha: 2026-10-13

## Checkpoint de este ciclo

- Rama de trabajo: `fix/sync-state-merge-inventory-20261013`
- Base: `fix/backend-allowlist-test-20261013` (`91bb2ad09989bd4a447e26d862181e57ab7f1a10`), que deriva de la línea de corrección P0 de sincronización.
- Alcance: P0-6, inventario explícito de claves de estado y sincronización de rutas/citas.
- Avisos: el estado operativo canónico está en `appState.pendientes`; el snapshot ya sincronizaba esa colección. No se añade una segunda copia independiente llamada `avisos`.
- Rutas/citas: se guardan aparte en `localStorage.sintergia_ia_rutas_v1`. El snapshot ahora incluye rutas y citas; el merge conserva rutas de ambos dispositivos, combina citas por ID y no permite que una entrada con marca temporal anterior sobrescriba una más nueva. Si el almacenamiento local falla, se revierte el merge en memoria y se rechaza la aplicación del snapshot.
- Inventario appState: `clientes`, `partes`, `facturas`, `pendientes`, `partCounter`, `facCounter`, `filtroEstadoActivo`, `filtroFacturaEstadoActivo`, `filtroAvisosEstadoActivo`, `catalogo`, `stock`, `stockListas`, `emailApi`, `firmaDataUrl`, `sinFirmaAutorizado`, `parteOrigenId`, `parteCadenaIds`, `tripInterval`, `workInterval`, `tripSeconds`, `workSeconds`, `totalKmReal`, `lastCoords`, `watchId`, `facturaActualSubiendoReciboIdx`, `facturaActualPrevisualizandoIdx`, `previewActual`, `gpsLogActive`. La prueba exige política explícita para cada clave.
- Fuera de appState: `horario` y `compras` ya están en el snapshot; `rutas` y `citas` se han añadido. `geo`, `flota`, `base`, `riaFin`, `riaObjetivoHoras`, `riaVelocidad`, `riaColchonMin`, `riesgos`, `nube` y `ultimoConsejo` permanecen locales por ahora; revisar política compartida por separado.
- Seguridad: `emailApi`, contexto de firma, coordenadas y timers no se sincronizan como datos de estado común.
- Límite abierto: las eliminaciones de rutas todavía no tienen tombstones distribuidos. El merge por unión evita pérdida de rutas, pero no propaga una eliminación de ruta entre dispositivos. Requiere un siguiente cambio específico con pruebas.
- CI verificado en verde: [run 38448692475](https://github.com/sintergiase-lgtm/SintergiaSE-APP/actions/runs/38448692475). Pasaron inventario de claves, merge de rutas/citas, rollback por fallo de persistencia, pruebas P0 anteriores y análisis sintáctico de scripts inline.
- Bloqueo de integración: no se ha probado contra un Supabase de pruebas ni en navegador real. No tocar producción, `main`, datos o secrets.

## Siguiente acción exacta

1. Verificar CI de esta rama y corregir cualquier fallo antes de avanzar.
2. Después, crear la siguiente rama P0 para simular POST/GET autenticado, respuesta perdida, cuota agotada y cambios concurrentes entre dos dispositivos.
3. Mantener las pruebas que requieren Supabase real como bloqueos explícitos hasta que exista un proyecto de pruebas autorizado.
