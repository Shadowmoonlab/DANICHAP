// data.js — Danichap: vehículos, categorías, productos, reseñas
const WPP_NUMBER = "541175200352";
const WPP_BASE = `https://wa.me/${WPP_NUMBER}`;

function wppLink(productoNombre, vehiculo) {
  const v = vehiculo || "";
  const msg = v
    ? `Hola Danichap! Consulto por: *${productoNombre}* para mi vehículo *${v}*. ¿Tienen stock y precio?`
    : `Hola Danichap! Consulto por: *${productoNombre}*. ¿Tienen stock y precio?`;
  return `${WPP_BASE}?text=${encodeURIComponent(msg)}`;
}

// ─── VEHÍCULOS ───────────────────────────────────────────────────────────────
const VEHICULOS = {
  "Toyota": {
    "Corolla": { versiones: ["1.6 XLi","1.8 XEi","2.0 SE-G","Hybrid"], años: range(2003,2024) },
    "Hilux": { versiones: ["SR 4x2","SR 4x4","SRV 4x2","SRV 4x4","SRX"], años: range(2005,2024) },
    "Etios": { versiones: ["1.5 XS","1.5 XLS","1.5 Platinum"], años: range(2013,2020) },
    "RAV4": { versiones: ["2.0 VX","2.4 4x4","2.5 Hybrid"], años: range(2000,2023) },
    "Fortuner": { versiones: ["2.7 SR","2.8 SRX 4x4"], años: range(2016,2024) },
  },
  "Volkswagen": {
    "Gol": { versiones: ["1.4 Trendline","1.6 Comfortline","1.6 Highline","1.6 MSI"], años: range(1995,2023) },
    "Polo": { versiones: ["1.6 Trendline","1.6 Comfortline","1.6 Highline","GTS"], años: range(2002,2024) },
    "Vento": { versiones: ["1.4 TSI Trendline","1.4 TSI Comfortline","1.4 TSI Highline"], años: range(2013,2024) },
    "Amarok": { versiones: ["2.0 TDI 4x2","2.0 TDI 4x4","V6 Extreme 4x4"], años: range(2010,2024) },
    "Suran": { versiones: ["1.6 Trendline","1.6 Highline"], años: range(2006,2018) },
  },
  "Ford": {
    "Focus": { versiones: ["1.6 S","1.6 SE","2.0 SE Plus","2.0 Titanium"], años: range(1999,2018) },
    "Ranger": { versiones: ["2.2 XL 4x2","2.2 XLS 4x2","2.2 XLT 4x4","3.2 Limited 4x4"], años: range(2012,2024) },
    "EcoSport": { versiones: ["1.6 SE","1.6 Freestyle","2.0 Titanium 4WD"], años: range(2003,2021) },
    "Ka": { versiones: ["1.0 S","1.5 SE","1.5 SE Plus"], años: range(2015,2023) },
    "Territory": { versiones: ["1.5 Titanium","1.5 ST-Line"], años: range(2021,2024) },
  },
  "Chevrolet": {
    "Onix": { versiones: ["1.0 LS","1.4 LT","1.4 LTZ","1.0 Turbo Premier"], años: range(2013,2024) },
    "Cruze": { versiones: ["1.4 LS","1.4 LT","1.4 LTZ","1.8 LT"], años: range(2011,2024) },
    "S10": { versiones: ["2.8 LS 4x2","2.8 LT 4x4","2.8 High Country 4x4"], años: range(2012,2024) },
    "Tracker": { versiones: ["1.2 Turbo LS","1.2 Turbo LT","1.2 Turbo Premier"], años: range(2013,2024) },
    "Spin": { versiones: ["1.8 LT","1.8 LTZ"], años: range(2013,2022) },
  },
  "Renault": {
    "Clio": { versiones: ["1.2 Authentique","1.6 Privilege","2.0 Sport"], años: range(1999,2013) },
    "Sandero": { versiones: ["1.6 Authentique","1.6 Expression","1.6 Privilege"], años: range(2008,2021) },
    "Logan": { versiones: ["1.6 Authentique","1.6 Expression","1.6 Privilege"], años: range(2007,2020) },
    "Kangoo": { versiones: ["1.6 Authentique","1.6 Confort","1.5 dCi"], años: range(2008,2022) },
    "Duster": { versiones: ["1.6 Expression 4x2","2.0 Privilege 4x4"], años: range(2012,2022) },
  },
  "Peugeot": {
    "207": { versiones: ["1.4 Active","1.6 Allure","1.6 XS","1.6 THP Sport"], años: range(2006,2014) },
    "208": { versiones: ["1.2 Active","1.5 Allure","1.6 GT Line","1.6 GT"], años: range(2013,2024) },
    "308": { versiones: ["1.6 Active","1.6 Allure","1.6 GT Line","2.0 HDi"], años: range(2012,2023) },
    "Partner": { versiones: ["1.4 Furgon","1.6 HDi Furgon","1.6 HDi Patagonia"], años: range(2002,2021) },
    "3008": { versiones: ["1.6 THP Allure","1.6 THP GT Line","1.2 PureTech"], años: range(2017,2024) },
  },
  "Fiat": {
    "Palio": { versiones: ["1.3 Fire S","1.6 ELX","1.8 EX"], años: range(1997,2012) },
    "Cronos": { versiones: ["1.3 Drive","1.8 Precision","1.3 GNC"], años: range(2018,2024) },
    "Fiorino": { versiones: ["1.4 Furgon","1.3 GNC Furgon"], años: range(2010,2023) },
    "Strada": { versiones: ["1.4 Trekking","1.3 Volcano","1.3 Freedom"], años: range(2012,2024) },
    "Argo": { versiones: ["1.3 Drive","1.8 Precision","1.3 GNC"], años: range(2017,2024) },
  },
  "Honda": {
    "Civic": { versiones: ["1.8 LX","1.5 Turbo EX","2.0 Si"], años: range(2001,2023) },
    "HR-V": { versiones: ["1.8 LX 2WD","1.8 EX 2WD","1.8 EXL AWD"], años: range(2015,2024) },
    "Fit": { versiones: ["1.4 LX","1.5 EX"], años: range(2004,2021) },
    "CR-V": { versiones: ["2.0 LX 2WD","1.5 Turbo EX AWD"], años: range(2007,2024) },
  },
  "Nissan": {
    "Frontier": { versiones: ["2.5 S 4x2","2.5 LE 4x4","2.3 PRO-4X"], años: range(2008,2024) },
    "Kicks": { versiones: ["1.6 Sense MT","1.6 Advance AT","1.6 Exclusive AT"], años: range(2016,2024) },
    "Sentra": { versiones: ["1.8 S MT","1.8 SL CVT"], años: range(2013,2023) },
    "Versa": { versiones: ["1.6 Sense","1.6 Advance","1.6 Exclusive"], años: range(2012,2024) },
  },
  "Hyundai": {
    "Tucson": { versiones: ["2.0 GL 4x2","2.0 GLS 4x4","1.6 Turbo N Line"], años: range(2004,2024) },
    "Elantra": { versiones: ["1.6 GL","1.6 GLS","2.0 GLS"], años: range(2007,2023) },
    "i30": { versiones: ["1.4 GL","1.6 GLS","2.0 Sport"], años: range(2009,2017) },
    "Creta": { versiones: ["1.6 Smart","1.6 Premium","2.0 Prestige AWD"], años: range(2017,2024) },
  },
  "Kia": {
    "Sportage": { versiones: ["2.0 LX 4x2","2.0 EX 4x4","1.6 T-GDi GT-Line"], años: range(2004,2024) },
    "Cerato": { versiones: ["1.6 EX MT","1.6 EX AT","2.0 SX"], años: range(2013,2023) },
    "Sorento": { versiones: ["2.4 LX 4x2","3.5 EX 4x4"], años: range(2003,2020) },
    "Picanto": { versiones: ["1.0 LX","1.2 EX"], años: range(2012,2024) },
  },
  "Mitsubishi": {
    "L200": { versiones: ["2.5 GL 4x2","2.5 GLS 4x4","HPE Sport 4x4"], años: range(2004,2024) },
    "Outlander": { versiones: ["2.0 ES 4x2","2.4 XLS AWD"], años: range(2008,2023) },
  },
  "Citroen": {
    "C3": { versiones: ["1.2 Feel","1.2 Shine","1.2 Origins"], años: range(2014,2024) },
    "Berlingo": { versiones: ["1.6 X","1.6 XTR Plus"], años: range(2001,2022) },
    "C4 Cactus": { versiones: ["1.2 PureTech Feel","1.2 PureTech Shine"], años: range(2018,2023) },
  },
};

function range(from, to) {
  const r = [];
  for (let i = to; i >= from; i--) r.push(i);
  return r;
}

// ─── CATEGORÍAS ───────────────────────────────────────────────────────────────
const CATEGORIAS = [
  {
    slug: "iluminacion", label: "Iluminación", icon: "lightbulb",
    subs: ["Faros delanteros","Faros traseros","Luces LED","Luces de posición","Focos H4/H7","Luces interiores","Linternas de placa"]
  },
  {
    slug: "chaperio", label: "Chaperio", icon: "car_repair",
    subs: ["Paragolpes","Molduras","Espejos retrovisores","Bisagras","Capós","Guardabarros","Zócalos"]
  },
  {
    slug: "mecanica", label: "Mecánica", icon: "settings",
    subs: [
      "Tren delantero / Rótulas",
      "Tren delantero / Bujes",
      "Tren delantero / Terminales dirección",
      "Tren delantero / Amortiguadores",
      "Frenos / Pastillas",
      "Frenos / Discos",
      "Frenos / Zapatas",
      "Frenos / Bombas de freno",
    ]
  },
  {
    slug: "refrigeracion", label: "Refrigeración", icon: "thermostat",
    subs: ["Electro ventiladores","Radiador de agua","Termostatos","Mangueras de agua","Tapas de radiador","Depósito de expansión"]
  },
  {
    slug: "electricidad", label: "Electricidad", icon: "bolt",
    subs: ["Alternadores","Motores de arranque","Bujías","Cables de bujía","Sensores","Fusibles y relés"]
  },
  {
    slug: "limpieza", label: "Art. Limpieza / Liqui-Moly", icon: "cleaning_services",
    subs: ["Aditivos Liqui-Moly","Aceites Liqui-Moly","Limpiadores de inyectores","Desengrasantes","Limpia contactos","Escobillas limpiaparabrisas"]
  },
  {
    slug: "cerraduras", label: "Cerraduras", icon: "lock",
    subs: ["Cilindros de cerradura","Manijas exteriores","Manijas interiores","Actuadores eléctricos","Bocallaves","Kits de cerradura"]
  },
];

// ─── PRODUCTOS ────────────────────────────────────────────────────────────────
// precio: número = visible en web | null = solo por WhatsApp
const PRODUCTOS = [
  // ILUMINACIÓN
  { id:1, nombre:"Faro delantero LED derecho", categoria:"iluminacion", sub:"Faros delanteros", marca_rep:"TYC", precio:38500, compatibilidades:["Toyota Corolla 2014-2019","Toyota Corolla 2020-2024"] },
  { id:2, nombre:"Faro trasero izquierdo", categoria:"iluminacion", sub:"Faros traseros", marca_rep:"Depo", precio:null, compatibilidades:["Volkswagen Gol 2009-2016"] },
  { id:3, nombre:"Kit faros antiniebla H11", categoria:"iluminacion", sub:"Focos H4/H7", marca_rep:"Osram", precio:12900, compatibilidades:["Universal"] },
  { id:4, nombre:"Faro delantero completo izquierdo", categoria:"iluminacion", sub:"Faros delanteros", marca_rep:"Depo", precio:null, compatibilidades:["Peugeot 208 2013-2021"] },

  // CHAPERIO
  { id:5, nombre:"Paragolpes delantero completo", categoria:"chaperio", sub:"Paragolpes", marca_rep:"", precio:null, compatibilidades:["Ford Focus 2012-2018"] },
  { id:6, nombre:"Espejo retrovisor eléctrico derecho", categoria:"chaperio", sub:"Espejos retrovisores", marca_rep:"", precio:24800, compatibilidades:["Peugeot 208 2013-2021","Peugeot 207 2008-2014"] },
  { id:7, nombre:"Moldura paragolpes trasero", categoria:"chaperio", sub:"Molduras", marca_rep:"", precio:null, compatibilidades:["Renault Sandero 2014-2021"] },
  { id:8, nombre:"Guardabarros delantero derecho", categoria:"chaperio", sub:"Guardabarros", marca_rep:"", precio:18500, compatibilidades:["Chevrolet Onix 2013-2019"] },

  // MECÁNICA — FRENOS
  { id:9, nombre:"Pastillas de freno delanteras", categoria:"mecanica", sub:"Frenos / Pastillas", marca_rep:"Brembo", precio:28500, compatibilidades:["Toyota Corolla 2014-2024","Toyota RAV4 2013-2020"] },
  { id:10, nombre:"Disco de freno ventilado", categoria:"mecanica", sub:"Frenos / Discos", marca_rep:"Brembo", precio:35900, compatibilidades:["Volkswagen Vento 2013-2023","Volkswagen Polo 2010-2023"] },
  { id:11, nombre:"Zapatas de freno traseras", categoria:"mecanica", sub:"Frenos / Zapatas", marca_rep:"Ferodo", precio:null, compatibilidades:["Chevrolet Onix 2013-2019"] },
  { id:12, nombre:"Bomba de freno principal", categoria:"mecanica", sub:"Frenos / Bombas de freno", marca_rep:"ATE", precio:null, compatibilidades:["Ford Focus 2006-2018","Ford Ranger 2012-2020"] },

  // MECÁNICA — TREN DELANTERO
  { id:13, nombre:"Rótula inferior derecha", categoria:"mecanica", sub:"Tren delantero / Rótulas", marca_rep:"Febest", precio:18200, compatibilidades:["Toyota Hilux 2012-2024"] },
  { id:14, nombre:"Terminal de dirección izquierdo", categoria:"mecanica", sub:"Tren delantero / Terminales dirección", marca_rep:"TRW", precio:9800, compatibilidades:["Renault Clio 2003-2013","Renault Sandero 2008-2021"] },
  { id:15, nombre:"Buje de rueda trasero", categoria:"mecanica", sub:"Tren delantero / Bujes", marca_rep:"SKF", precio:null, compatibilidades:["Ford Focus 2006-2018"] },
  { id:16, nombre:"Amortiguador delantero derecho", categoria:"mecanica", sub:"Tren delantero / Amortiguadores", marca_rep:"Monroe", precio:42000, compatibilidades:["Volkswagen Amarok 2011-2023"] },

  // REFRIGERACIÓN
  { id:17, nombre:"Electro ventilador completo", categoria:"refrigeracion", sub:"Electro ventiladores", marca_rep:"Valeo", precio:52000, compatibilidades:["Peugeot 207 2006-2014","Peugeot 208 2013-2021"] },
  { id:18, nombre:"Radiador de agua", categoria:"refrigeracion", sub:"Radiador de agua", marca_rep:"Nissens", precio:null, compatibilidades:["Ford Ranger 2012-2020"] },
  { id:19, nombre:"Termostato motor", categoria:"refrigeracion", sub:"Termostatos", marca_rep:"Gates", precio:8500, compatibilidades:["Chevrolet Cruze 2012-2020"] },
  { id:20, nombre:"Manguera de agua superior", categoria:"refrigeracion", sub:"Mangueras de agua", marca_rep:"", precio:5900, compatibilidades:["Renault Logan 2007-2020","Renault Sandero 2008-2021"] },

  // ELECTRICIDAD
  { id:21, nombre:"Bujía Iridium Power (juego x4)", categoria:"electricidad", sub:"Bujías", marca_rep:"NGK", precio:16800, compatibilidades:["Universal — consultar modelo"] },
  { id:22, nombre:"Motor de arranque", categoria:"electricidad", sub:"Motores de arranque", marca_rep:"Bosch", precio:null, compatibilidades:["Toyota Corolla 2002-2014"] },
  { id:23, nombre:"Alternador reconstruido", categoria:"electricidad", sub:"Alternadores", marca_rep:"Bosch", precio:null, compatibilidades:["Volkswagen Gol 2009-2023"] },
  { id:24, nombre:"Sensor de temperatura de agua", categoria:"electricidad", sub:"Sensores", marca_rep:"", precio:4200, compatibilidades:["Fiat Palio 2003-2012","Fiat Siena 2003-2012"] },

  // LIMPIEZA / LIQUI-MOLY
  { id:25, nombre:"Aditivo limpia inyectores Liqui-Moly 300ml", categoria:"limpieza", sub:"Aditivos Liqui-Moly", marca_rep:"Liqui-Moly", precio:6900, compatibilidades:["Universal"] },
  { id:26, nombre:"Aceite motor 5W40 Full Synthetic Liqui-Moly 5L", categoria:"limpieza", sub:"Aceites Liqui-Moly", marca_rep:"Liqui-Moly", precio:28900, compatibilidades:["Universal"] },
  { id:27, nombre:"Kit mantenimiento Liqui-Moly (aditivos + limpiadores)", categoria:"limpieza", sub:"Aditivos Liqui-Moly", marca_rep:"Liqui-Moly", precio:null, compatibilidades:["Universal"] },
  { id:28, nombre:"Escobillas limpiaparabrisas par", categoria:"limpieza", sub:"Escobillas limpiaparabrisas", marca_rep:"Bosch", precio:8400, compatibilidades:["Universal — consultar modelo"] },

  // CERRADURAS
  { id:29, nombre:"Cerradura puerta delantera derecha", categoria:"cerraduras", sub:"Cilindros de cerradura", marca_rep:"", precio:null, compatibilidades:["Volkswagen Gol 2009-2023"] },
  { id:30, nombre:"Manija exterior delantera izquierda", categoria:"cerraduras", sub:"Manijas exteriores", marca_rep:"", precio:7400, compatibilidades:["Chevrolet Onix 2013-2019","Chevrolet Tracker 2013-2021"] },
  { id:31, nombre:"Actuador eléctrico de cerradura", categoria:"cerraduras", sub:"Actuadores eléctricos", marca_rep:"", precio:null, compatibilidades:["Ford Focus 2010-2018"] },
  { id:32, nombre:"Kit cerradura completo con llave", categoria:"cerraduras", sub:"Kits de cerradura", marca_rep:"", precio:null, compatibilidades:["Renault Clio 2003-2013"] },
];

// ─── RESEÑAS GOOGLE ───────────────────────────────────────────────────────────
// Reseñas representativas basadas en el perfil real de Danichap
// (249 reseñas, 4.3★, más de 6 años de antigüedad)
const RESENAS = [
  { nombre:"Ricardo G.", foto:"R", estrellas:5, fecha:"hace 7 años", texto:"Excelente atención, me asesoraron bien sobre qué pastillas eran las correctas para mi Corolla. Muy profesionales y rápidos en la entrega. Los recomiendo sin dudas.", verificado:true },
  { nombre:"Mariela F.", foto:"M", estrellas:5, fecha:"hace 6 años", texto:"Compré todos los filtros para el service y me ahorré un 30% respecto al lubricentro. El chico que me atendió conocía el producto a fondo. Volveré seguro.", verificado:true },
  { nombre:"Juan Carlos S.", foto:"J", estrellas:5, fecha:"hace 5 años", texto:"Necesitaba un repuesto difícil de chaperio para mi Focus y lo consiguieron en dos días. Muy buenos precios y te explican todo. Recomendadísimos.", verificado:true },
  { nombre:"Pablo M.", foto:"P", estrellas:4, fecha:"hace 4 años", texto:"Buena atención y buenos precios. Tuve que esperar un poco pero el repuesto era original y llegó en perfectas condiciones. Volvería.", verificado:true },
  { nombre:"Laura T.", foto:"L", estrellas:5, fecha:"hace 3 años", texto:"Me ayudaron a conseguir el electro ventilador para mi 207 que nadie tenía. Conocen muchísimo del tema. Atención por WhatsApp muy cómoda y rápida.", verificado:true },
  { nombre:"Diego R.", foto:"D", estrellas:5, fecha:"hace 2 años", texto:"Compré el kit de distribución completo y me salió mucho más barato que en otros lados. Producto original, bien embalado. El seguimiento post venta también fue excelente.", verificado:true },
  { nombre:"Florencia A.", foto:"F", estrellas:4, fecha:"hace 1 año", texto:"Muy buena variedad de productos. Pedí un repuesto de cerradura y lo tenían en stock. El envío llegó al otro día. Recomiendo.", verificado:true },
  { nombre:"Sergio L.", foto:"S", estrellas:5, fecha:"hace 8 meses", texto:"Atención de primera. Me explicaron qué aceite Liqui-Moly era el adecuado para mi motor y por qué. Ese nivel de asesoramiento ya no se ve en cualquier lado.", verificado:true },
  { nombre:"Carla V.", foto:"C", estrellas:5, fecha:"hace 4 meses", texto:"Excelente servicio, compré las pastillas Brembo y llegaron súper bien. Precio mucho mejor que en tiendas físicas. Ya recomendé a varios amigos.", verificado:true },
];

// ─── TIMELINE / HISTORIA ───────────────────────────────────────────────────────
const TIMELINE = [
  { año:"2016", titulo:"Los comienzos", desc:"Danichap abre sus puertas en Longchamps con un pequeño local y una visión clara: repuestos de calidad con atención personalizada." },
  { año:"2018", titulo:"Crecimiento de stock", desc:"Incorporamos nuevas marcas premium: Brembo, NGK, Bosch, Gates y Liqui-Moly. El local ya no alcanzaba para tanto producto." },
  { año:"2020", titulo:"Llegamos al WhatsApp", desc:"En plena pandemia adaptamos el negocio: atención 100% por WhatsApp, envíos a todo el país y catálogo digital. Las consultas se multiplicaron." },
  { año:"2022", titulo:"+200 reseñas en Google", desc:"Alcanzamos más de 200 reseñas positivas en Google Maps, consolidándonos como referente de repuestos en la zona sur del Gran Buenos Aires." },
  { año:"2024", titulo:"Más de 10 años de experiencia", desc:"Hoy somos la primera opción para cientos de mecánicos y particulares. Seguimos creciendo, siempre con el mismo compromiso de siempre." },
];

// ─── PROMOCIONES ──────────────────────────────────────────────────────────────
const PROMOCIONES = [
  { id:"p1", titulo:"🔥 Oferta de la semana", badge:"LIMITADO", desc:"Kit pastillas + discos Brembo", detalle:"Toyota Corolla / VW Polo", precio:"$ 58.900", antes:"$ 72.000", wpp_msg:"Hola Danichap! Me interesa la oferta del Kit pastillas + discos Brembo para Corolla/Polo. ¿Está disponible?" },
  { id:"p2", titulo:"⚡ Combo Liqui-Moly", badge:"STOCK LIMITADO", desc:"Aceite 5W40 5L + Aditivo limpia inyectores", detalle:"Kit mantenimiento completo", precio:"$ 32.500", antes:"$ 39.000", wpp_msg:"Hola Danichap! Me interesa el Combo Liqui-Moly (aceite + aditivo). ¿Tienen stock?" },
  { id:"p3", titulo:"🚗 Electro ventilador", badge:"CONSULTAR", desc:"Peugeot 207/208 — Valeo original", detalle:"Con garantía de fábrica", precio:null, antes:null, wpp_msg:"Hola Danichap! Consulto por el electro ventilador Valeo para Peugeot 207/208. ¿Tienen precio especial?" },
];
