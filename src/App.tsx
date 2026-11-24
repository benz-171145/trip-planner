import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db, tripsRef } from './firebase';
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import {
  AlertTriangle,
  BadgePercent,
  Check,
  CheckCircle2,
  ClipboardList,
  Cloud,
  CloudFog,
  CloudRain,
  CloudSun,
  Copy,
  Car,
  CarFront,
  Clock,
  Coins,
  ExternalLink,
  Flag,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Fuel,
  ImagePlus,
  Loader2,
  MapPin,
  MapPinned,
  Moon,
  Navigation,
  Plus,
  Receipt,
  Repeat,
  RotateCcw,
  Route as RouteIcon,
  Save,
  Snowflake,
  Sun,
  Trash2,
  Tent,
  Users,
  UtensilsCrossed,
  Wallet,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// ---------- Types ----------

type Waypoint = {
  id: number;
  name: string;
};

type Day = {
  id: number;
  stops: Waypoint[];
};

let idSeq = 0;
const uid = () => Date.now() * 1000 + (idSeq++ % 1000);

const emptyDays = (): Day[] => [{ id: uid(), stops: [{ id: uid(), name: '' }] }];

const toDays = (groups: string[][]): Day[] =>
  groups.map((names) => ({
    id: uid(),
    stops: names.map((name) => ({ id: uid(), name })),
  }));

// รองรับทริปเก่า (stopNames แบบ Array ธรรมดา) → แปลงเป็น "วันที่ 1"
function daysFromTrip(trip: {
  days?: { stops?: string[] }[];
  stopNames?: string[];
}): Day[] {
  if (Array.isArray(trip.days)) {
    return toDays(
      trip.days.map((d) => (Array.isArray(d?.stops) ? d.stops.map(String) : []))
    );
  }
  if (Array.isArray(trip.stopNames) && trip.stopNames.length > 0) {
    return toDays([trip.stopNames.map(String)]);
  }
  return [];
}

type Night = {
  id: number;
  label: string;
  amount: string;
};

type Coord = { lat: number; lon: number };

type RouteInfo = {
  line: [number, number][];
  distanceKm: number;
  durationMin: number;
};

const makeNight = (n: number, amount = ''): Night => ({
  id: Date.now() + n,
  label: `คืนที่ ${n}`,
  amount,
});

// ---------- Saved trips (Firestore) ----------

type SavedTrip = {
  id: string;
  name: string;
  travelDate: string;
  note: string;
  origin: string;
  destination: string;
  stopNames?: string[];
  days?: { stops: string[] }[];
  carName: string;
  fuelEfficiency: string;
  fuelPrice: string;
  nightAmounts: string[];
  food: string;
  roundTrip: boolean;
  travelers: string;
  totalDistanceKm: number;
  grandTotal: number;
  photos: string[];
  status?: 'planning' | 'done';
  checklist?: ChecklistItem[];
  actualSpend?: number | null;
};

type ChecklistItem = {
  id: number;
  text: string;
  done: boolean;
};

const DEFAULT_CHECKLIST = [
  'เช็กลมยาง / น้ำมันเครื่อง',
  'เตรียมสายชาร์จให้พอ',
  'ยาประจำตัว',
  'จองที่พักแล้ว',
].map((text, i) => ({ id: Date.now() + i, text, done: false }));

// ---------- Geocoding (OpenStreetMap Nominatim) ----------

async function fetchGeocode(name: string, signal?: AbortSignal): Promise<Coord | null> {
  const url =
    'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=th&countrycodes=th&q=' +
    encodeURIComponent(name);
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal });
  if (!res.ok) throw new Error('geocode failed');
  const data: Array<{ lat: string; lon: string }> = await res.json();
  if (!Array.isArray(data) || data.length === 0) return null;
  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
}

// ---------- Routing (OSRM driving) ----------

async function fetchRoute(
  pts: Coord[],
  signal?: AbortSignal
): Promise<RouteInfo> {
  const path = pts.map((p) => `${p.lon},${p.lat}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${path}?overview=full&geometries=geojson`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error('routing failed');
  const data = await res.json();
  if (data.code !== 'Ok' || !data.routes?.[0]) throw new Error('no route');
  const route = data.routes[0];
  return {
    line: route.geometry.coordinates.map(([lng, lat]: [number, number]) => [lat, lng]),
    distanceKm: route.distance / 1000,
    durationMin: route.duration / 60,
  };
}

// ---------- Weather (Open-Meteo, ไม่ต้องใช้ API Key) ----------

type Weather = { temp: number; code: number; rainProb: number };

async function fetchWeather(
  lat: number,
  lon: number,
  signal?: AbortSignal
): Promise<Weather> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    '&current=temperature_2m,weather_code&daily=precipitation_probability_max' +
    '&forecast_days=1&timezone=auto';
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error('weather failed');
  const data = await res.json();
  const temp = data?.current?.temperature_2m;
  const code = data?.current?.weather_code;
  const rainProb = data?.daily?.precipitation_probability_max?.[0];
  if (typeof temp !== 'number' || typeof code !== 'number') {
    throw new Error('bad weather data');
  }
  return { temp, code, rainProb: typeof rainProb === 'number' ? rainProb : 0 };
}

function weatherMeta(code: number): { Icon: LucideIcon; label: string } {
  if (code === 0) return { Icon: Sun, label: 'แดดออก' };
  if (code === 1 || code === 2) return { Icon: CloudSun, label: 'มีเมฆบางส่วน' };
  if (code === 3) return { Icon: Cloud, label: 'เมฆมาก' };
  if (code === 45 || code === 48) return { Icon: CloudFog, label: 'หมอกลง' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86)
    return { Icon: Snowflake, label: 'อากาศหนาวจัด' };
  if (code >= 95) return { Icon: CloudRain, label: 'ฝนฟ้าคะนอง' };
  if (code >= 51) return { Icon: CloudRain, label: 'มีฝนตก' };
  return { Icon: Cloud, label: 'ไม่ทราบสภาพอากาศ' };
}

// ---------- Hooks ----------

function useDebounced<T>(value: T, delay: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

// ---------- Formatters ----------

const fmtBaht = (n: number) =>
  n.toLocaleString('th-TH', { maximumFractionDigits: 0 }) + ' ฿';
const fmtNum = (n: number, digits = 1) =>
  n.toLocaleString('th-TH', { maximumFractionDigits: digits });
const parseNum = (v: string) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

// ---------- Photo helpers ----------

const MAX_PHOTOS = 4;
const MAX_DOC_BYTES = 900_000; // เผื่อมาร์จินก่อนชนขีดจำกัด 1MB ของเอกสาร Firestore

// ย่อรูปด้วย HTML5 Canvas (กว้างสุด 800px, JPEG 0.7) แล้วแปลงเป็น Base64
function resizeImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('decode failed'));
      img.onload = () => {
        const scale = Math.min(1, 800 / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('canvas failed'));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

const photosSizeBytes = (photos: string[]) =>
  photos.reduce((sum, p) => sum + p.length * 0.75, 0);

// ---------- Map helpers ----------

function pinIcon(bg: string, label: string, icon: 'start' | 'end' | 'stop') {
  return L.divIcon({
    className: '',
    html: `<div class="route-pin" style="background:${bg}"><span>${
      icon === 'start' ? '▶' : icon === 'end' ? '🏁' : label
    }</span></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -30],
  });
}

const NO_COORDS: [number, number][] = [];

function FitBounds({
  coords,
  active,
}: {
  coords: [number, number][];
  active: boolean;
}) {
  const map = useMap();
  useEffect(() => {
    // แผนที่ถูกซ่อนอยู่ (อีกแท็บ) → รอให้แสดงก่อน แล้วค่อยคำนวณขนาด/กรอบใหม่
    if (!active) return;
    map.invalidateSize();
    if (coords.length < 2) return;
    map.fitBounds(L.latLngBounds(coords), { padding: [48, 48] });
  }, [coords, map, active]);
  return null;
}

// ---------- App ----------

function App() {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem('theme');
    // ค่าเริ่มต้นเป็นโหมดสว่างเสมอ — ใช้โหมดมืดเมื่อผู้ใช้เลือกเองเท่านั้น
    return saved === 'dark';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  // บันทึกลง localStorage เฉพาะเมื่อผู้ใช้กดสลับธีมเอง
  const toggleTheme = () =>
    setDark((d) => {
      localStorage.setItem('theme', d ? 'light' : 'dark');
      return !d;
    });

  const [origin, setOrigin] = useState('เมืองร้อยเอ็ด');
  const [destination, setDestination] = useState('');
  const [tab, setTab] = useState<'plan' | 'saved'>('plan');
  const [days, setDays] = useState<Day[]>(emptyDays);

  const [carName, setCarName] = useState('Honda City 1.0 Turbo RS');
  const [fuelEfficiency, setFuelEfficiency] = useState('18');
  const [fuelPrice, setFuelPrice] = useState('37');
  const [nights, setNights] = useState<Night[]>([
    makeNight(1, '0'),
    makeNight(2, '0'),
  ]);
  const [food, setFood] = useState('0');

  const [roundTrip, setRoundTrip] = useState(false);
  const [travelers, setTravelers] = useState('2');

  const [geoResults, setGeoResults] = useState<Record<string, Coord | null>>({});
  const [geoLoading, setGeoLoading] = useState<string[]>([]);
  const [route, setRoute] = useState<RouteInfo | null>(null);
  const [routeStatus, setRouteStatus] = useState<
    'waiting' | 'loading' | 'ok' | 'error'
  >('waiting');

  const [savedTrips, setSavedTrips] = useState<SavedTrip[]>([]);
  const [tripsLoading, setTripsLoading] = useState(true);
  const [tripsError, setTripsError] = useState(false);
  const [savingTrip, setSavingTrip] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [tripName, setTripName] = useState('');
  const [travelDate, setTravelDate] = useState('');
  const [tripNote, setTripNote] = useState('');
  const [modalPhotos, setModalPhotos] = useState<string[]>([]);
  const [processingPhotos, setProcessingPhotos] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [editPhotosId, setEditPhotosId] = useState<string | null>(null);
  const [checklistId, setChecklistId] = useState<string | null>(null);
  const [newItemText, setNewItemText] = useState('');
  const [spendId, setSpendId] = useState<string | null>(null);
  const [spendInput, setSpendInput] = useState('');
  const [editPhotos, setEditPhotos] = useState<string[]>([]);
  const [lightbox, setLightbox] = useState<{ trip: SavedTrip; index: number } | null>(
    null
  );
  const [weather, setWeather] = useState<Weather | null>(null);
  const [weatherError, setWeatherError] = useState(false);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2500);
  };

  // จุดทั้งหมดเรียงต่อกัน: จุดเริ่มต้น → วันที่ 1 → วันที่ 2 → ... → ปลายทาง
  const routeMeta = useMemo(() => {
    const list: { name: string; day?: number; stopNo?: number }[] = [
      { name: origin.trim() },
    ];
    days.forEach((d, di) =>
      d.stops.forEach((s, si) =>
        list.push({ name: s.name.trim(), day: di + 1, stopNo: si + 1 })
      )
    );
    list.push({ name: destination.trim() });
    return list;
  }, [origin, days, destination]);

  const routePlaces = useMemo(() => routeMeta.map((m) => m.name), [routeMeta]);

  // หน่วง 1 วินาทีหลังหยุดพิมพ์ ก่อนยิงค้นหาพิกัด
  const debouncedPlacesKey = useDebounced(routePlaces.join('|'), 1000);
  const debouncedPlaces = useMemo(
    () => debouncedPlacesKey.split('|'),
    [debouncedPlacesKey]
  );

  // 1) Geocoding — ค้นหาพิกัดของทุกจุดที่ยังไม่รู้ผล
  useEffect(() => {
    const names = debouncedPlaces.filter((n) => n.length > 0);
    const missing = names.filter((n) => !(n in geoResults));
    if (missing.length === 0) return;

    let cancelled = false;
    setGeoLoading((prev) => [...new Set([...prev, ...missing])]);
    Promise.all(
      missing.map(async (n) => {
        const c = await fetchGeocode(n).catch(() => null);
        return [n, c] as const;
      })
    ).then((entries) => {
      if (cancelled) return;
      setGeoResults((prev) => {
        const next = { ...prev };
        for (const [n, c] of entries) next[n] = c;
        return next;
      });
      const found = new Set(missing);
      setGeoLoading((prev) => prev.filter((n) => !found.has(n)));
    });

    return () => {
      cancelled = true;
    };
  }, [debouncedPlaces, geoResults]);

  // 2) Routing — เมื่อพิกัดครบทุกจุด เรียก OSRM ขอเส้นทางถนนจริง + ระยะทาง
  useEffect(() => {
    const names = debouncedPlaces.filter((n) => n.length > 0);
    const unresolved = names.some((n) => !(n in geoResults)) || geoLoading.length > 0;

    if (unresolved) {
      setRouteStatus('waiting');
      return;
    }

    const pts = names
      .map((n) => geoResults[n])
      .filter((c): c is Coord => c !== null && c !== undefined);

    if (pts.length < 2) {
      setRoute(null);
      setRouteStatus(names.some((n) => geoResults[n] === null) ? 'error' : 'waiting');
      return;
    }

    const ctrl = new AbortController();
    setRouteStatus('loading');
    fetchRoute(pts, ctrl.signal)
      .then((r) => {
        setRoute(r);
        setRouteStatus('ok');
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        setRoute(null);
        setRouteStatus('error');
      });

    return () => ctrl.abort();
  }, [debouncedPlaces, geoResults, geoLoading]);

  // 3) คำนวณค่าใช้จ่าย — อัปเดตทันทีเมื่อตัวเลขในฟอร์มเปลี่ยน (Real-time)
  const totalDistanceKm = route ? route.distanceKm * (roundTrip ? 2 : 1) : null;
  const driveMinutes = route ? route.durationMin * (roundTrip ? 2 : 1) : null;

  const efficiency = parseNum(fuelEfficiency) || 1;
  const fuelLiters = totalDistanceKm !== null ? totalDistanceKm / efficiency : null;
  const fuelCost = fuelLiters !== null ? fuelLiters * parseNum(fuelPrice) : null;
  const stayCost = nights.reduce((sum, n) => sum + parseNum(n.amount), 0);
  const foodCost = parseNum(food);
  const grandTotal = (fuelCost ?? 0) + stayCost + foodCost;
  const perPerson = travelers.trim() !== '' && parseNum(travelers) > 0
    ? grandTotal / parseNum(travelers)
    : null;

  const expenseData = [
    { name: 'ค่าน้ำมัน', value: Math.round(fuelCost ?? 0), color: dark ? '#D4AE82' : '#4A6B5D' },
    { name: 'ค่าที่พัก', value: Math.round(stayCost), color: dark ? '#6B9483' : '#8F6840' },
    { name: 'ค่าอาหาร', value: Math.round(foodCost), color: dark ? '#B7CEC1' : '#C89F72' },
  ].filter((d) => d.value > 0);

  const addDay = () =>
    setDays((prev) => [...prev, { id: uid(), stops: [{ id: uid(), name: '' }] }]);
  const removeDay = (dayId: number) =>
    setDays((prev) => prev.filter((d) => d.id !== dayId));
  const addStop = (dayId: number) =>
    setDays((prev) =>
      prev.map((d) =>
        d.id === dayId ? { ...d, stops: [...d.stops, { id: uid(), name: '' }] } : d
      )
    );
  const removeStop = (dayId: number, stopId: number) =>
    setDays((prev) =>
      prev.map((d) =>
        d.id === dayId ? { ...d, stops: d.stops.filter((s) => s.id !== stopId) } : d
      )
    );
  const updateStop = (dayId: number, stopId: number, name: string) =>
    setDays((prev) =>
      prev.map((d) =>
        d.id === dayId
          ? { ...d, stops: d.stops.map((s) => (s.id === stopId ? { ...s, name } : s)) }
          : d
      )
    );

  const addNight = () => setNights((prev) => [...prev, makeNight(prev.length + 1)]);
  const removeNight = (id: number) =>
    setNights((prev) => prev.filter((n) => n.id !== id));
  const updateNightAmount = (id: number, amount: string) =>
    setNights((prev) => prev.map((n) => (n.id === id ? { ...n, amount } : n)));

  const resetAll = () => {
    setOrigin('เมืองร้อยเอ็ด');
    setDestination('');
    setDays(emptyDays());
    setCarName('Honda City 1.0 Turbo RS');
    setFuelEfficiency('18');
    setFuelPrice('37');
    setNights([makeNight(1, '0'), makeNight(2, '0')]);
    setFood('0');
  };

  const googleMapsUrl = useMemo(() => {
    const valid = routePlaces.filter((p) => p.trim() && geoResults[p.trim()]);
    if (valid.length < 2) return null;
    const waypoints = valid.slice(1, -1).map((p) => geoResults[p.trim()]!);
    const wp = waypoints.length
      ? waypoints.map((c) => `${c.lat},${c.lon}`).join('|') + '/'
      : '';
    const o = geoResults[valid[0]]!;
    const d = geoResults[valid[valid.length - 1]]!;
    return `https://www.google.com/maps/dir/?api=1&origin=${o.lat},${o.lon}&destination=${d.lat},${d.lon}${wp ? `&waypoints=${wp}` : ''}&travelmode=driving`;
  }, [routePlaces, geoResults]);

  const isNotFound = (name: string) =>
    name.trim().length > 0 &&
    debouncedPlaces.includes(name.trim()) &&
    geoResults[name.trim()] === null;

  const NotFoundWarning = () => (
    <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-rose-500">
      <AlertTriangle size={12} />
      ไม่พบพิกัดสถานที่ กรุณาระบุชื่อให้ชัดเจนขึ้น
    </p>
  );

  const saveCurrentTrip = async () => {
    setSavingTrip(true);
    try {
      await addDoc(tripsRef, {
        name: tripName.trim() || 'ทริปไม่มีชื่อ',
        travelDate,
        note: tripNote.trim(),
        createdAt: serverTimestamp(),
        status: 'planning',
        checklist: DEFAULT_CHECKLIST,
        actualSpend: null,
        origin: origin.trim(),
        destination: destination.trim(),
        days: days.map((d) => ({
          stops: d.stops.map((s) => s.name.trim()).filter(Boolean),
        })),
        stopNames: days.flatMap((d) => d.stops.map((s) => s.name.trim()).filter(Boolean)),
        carName: carName.trim(),
        fuelEfficiency,
        fuelPrice,
        nightAmounts: nights.map((n) => n.amount),
        food,
        roundTrip,
        travelers,
        totalDistanceKm: totalDistanceKm ?? 0,
        grandTotal,
        photos: modalPhotos,
      });
      setShowSaveModal(false);
      setTripName('');
      setTravelDate('');
      setTripNote('');
      setModalPhotos([]);
    } catch {
      setTripsError(true);
    } finally {
      setSavingTrip(false);
    }
  };

  const addPhotos = async (
    files: FileList | null,
    current: string[],
    onDone: (photos: string[]) => void
  ) => {
    if (!files || files.length === 0) return;
    setPhotoError('');
    const room = MAX_PHOTOS - current.length;
    const picked = Array.from(files).slice(0, Math.max(0, room));
    if (picked.length === 0) {
      setPhotoError(`เพิ่มรูปได้สูงสุด ${MAX_PHOTOS} รูปต่อทริป`);
      return;
    }
    setProcessingPhotos(true);
    try {
      const added: string[] = [];
      for (const file of picked) {
        const b64 = await resizeImage(file);
        if (photosSizeBytes([...current, ...added, b64]) > MAX_DOC_BYTES) {
          setPhotoError('รูปรวมกันใหญ่เกินขีดจำกัด ลองเลือกรูปที่มีขนาดเล็กลง');
          break;
        }
        added.push(b64);
      }
      if (added.length > 0) onDone([...current, ...added]);
    } catch {
      setPhotoError('ไม่สามารถอ่านไฟล์รูปภาพนี้ได้');
    } finally {
      setProcessingPhotos(false);
    }
  };

  const saveTripPhotos = async (id: string, photos: string[]) => {
    try {
      await updateDoc(doc(db, 'trips', id), { photos });
      return true;
    } catch {
      setTripsError(true);
      return false;
    }
  };

  const removePhotoFromTrip = async (trip: SavedTrip, index: number) => {
    const photos = trip.photos.filter((_, i) => i !== index);
    await saveTripPhotos(trip.id, photos);
    if (lightbox?.trip.id === trip.id) {
      if (photos.length === 0) setLightbox(null);
      else setLightbox({ trip: { ...trip, photos }, index: Math.min(index, photos.length - 1) });
    }
  };

  const loadTrip = (trip: SavedTrip) => {
    setOrigin(trip.origin);
    setDestination(trip.destination);
    const loaded = daysFromTrip(trip);
    setDays(loaded.length > 0 ? loaded : emptyDays());
    setCarName(trip.carName);
    setFuelEfficiency(trip.fuelEfficiency);
    setFuelPrice(trip.fuelPrice);
    setNights(trip.nightAmounts.map((amount, i) => makeNight(i + 1, amount)));
    setFood(trip.food);
    setRoundTrip(trip.roundTrip);
    setTravelers(trip.travelers || '2');
    setTab('plan');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // เปิดหน้าเว็บ: ดึงทริปทั้งหมดจาก Firestore แบบ real-time
  useEffect(() => {
    const q = query(tripsRef, orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setSavedTrips(
          snap.docs.map((d) => ({ id: d.id, ...d.data() } as SavedTrip))
        );
        setTripsLoading(false);
        setTripsError(false);
      },
      () => {
        setTripsLoading(false);
        setTripsError(true);
      }
    );
    return unsub;
  }, []);

  const deleteTrip = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteDoc(doc(db, 'trips', id));
    } catch {
      setTripsError(true);
    } finally {
      setDeletingId(null);
    }
  };

  const markerPoints: [number, number][] = routePlaces
    .filter((n) => n.length > 0 && geoResults[n])
    .map((n) => [geoResults[n]!.lat, geoResults[n]!.lon]);

  const mapLine: [number, number][] | null = route
    ? route.line
    : markerPoints.length >= 2
      ? markerPoints
      : null;

  const routing =
    routeStatus === 'waiting' || routeStatus === 'loading';

  // 4) พยากรณ์อากาศปลายทาง (Open-Meteo) — ดึงเมื่อพิกัดปลายทางพร้อม
  const destCoord = destination.trim() ? geoResults[destination.trim()] : undefined;
  useEffect(() => {
    if (!destCoord) return;
    const ctrl = new AbortController();
    setWeatherError(false);
    fetchWeather(destCoord.lat, destCoord.lon, ctrl.signal)
      .then(setWeather)
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        setWeather(null);
        setWeatherError(true);
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ยิงใหม่เฉพาะเมื่อพิกัดปลายทางเปลี่ยน
  }, [destCoord?.lat, destCoord?.lon]);
  const copyTripSummary = async () => {
    if (totalDistanceKm === null) return;
    const dayBlocks = days
      .map((d, di) => {
        const names = d.stops.map((s) => s.name.trim()).filter(Boolean);
        if (names.length === 0) return null;
        return [`📅 วันที่ ${di + 1}`, ...names.map((n, si) => `   ${si + 1}. ${n}`)].join('\n');
      })
      .filter((b) => b !== null);
    const routeLine = [
      `🟢 เริ่มต้น: ${origin.trim() || '—'}`,
      ...(dayBlocks.length ? ['', dayBlocks.join('\n\n'), ''] : []),
      `🏁 ปลายทาง: ${destination.trim() || '—'}`,
    ].join('\n');
    const msg = [
      `🚗 ${origin.trim() || '—'} ➡️ ${destination.trim() || '—'}${roundTrip ? ' (ไป-กลับ)' : ''}`,
      '',
      `📍 เส้นทาง:`,
      routeLine,
      '',
      `🛣️ ระยะทางรวม: ${fmtNum(totalDistanceKm)} กม.`,
      driveMinutes !== null
        ? `⏱️ เวลาเดินทาง ~${Math.floor(driveMinutes / 60)} ชม. ${Math.round(driveMinutes % 60)} นาที`
        : null,
      `🚙 รถ: ${carName.trim() || '—'}`,
      '',
      `💰 สรุปค่าใช้จ่าย:`,
      ` ⛽ ค่าน้ำมัน: ${fmtBaht(fuelCost ?? 0)}`,
      ` 🏨 ค่าที่พัก: ${fmtBaht(stayCost)}`,
      ` 🍜 ค่าอาหาร: ${fmtBaht(foodCost)}`,
      ` ─────────────`,
      ` ✅ ยอดรวม: ${fmtBaht(grandTotal)}`,
      perPerson !== null
        ? ` 👥 หาร ${parseNum(travelers)} คน = คนละ ${fmtBaht(perPerson)}`
        : null,
      '',
      `📝 วางแผนไว้กับ Trip Planner`,
    ]
      .filter((l) => l !== null)
      .join('\n');
    try {
      await navigator.clipboard.writeText(msg);
      showToast('✅ คัดลอกสรุปทริปเรียบร้อยแล้ว!');
    } catch {
      showToast('⚠️ คัดลอกไม่สำเร็จ ลองอีกครั้ง');
    }
  };

  // 6) สลับสถานะทริป และบันทึกลง Firestore ทันที
  const toggleTripStatus = async (trip: SavedTrip) => {
    const next = trip.status === 'done' ? 'planning' : 'done';
    try {
      await updateDoc(doc(db, 'trips', trip.id), { status: next });
    } catch {
      setTripsError(true);
    }
  };

  // 7) เช็กลิสต์เตรียมตัว — บันทึกอัตโนมัติลงเอกสารทริป
  const saveChecklist = async (id: string, checklist: ChecklistItem[]) => {
    try {
      await updateDoc(doc(db, 'trips', id), { checklist });
      return true;
    } catch {
      setTripsError(true);
      return false;
    }
  };

  const updateChecklist = (trip: SavedTrip, next: ChecklistItem[]) =>
    saveChecklist(trip.id, next);

  const addChecklistItem = (trip: SavedTrip) => {
    const text = newItemText.trim();
    if (!text) return;
    void updateChecklist(trip, [
      ...(trip.checklist ?? []),
      { id: Date.now(), text, done: false },
    ]);
    setNewItemText('');
  };

  const removeChecklistItem = (trip: SavedTrip, itemId: number) =>
    void updateChecklist(
      trip,
      (trip.checklist ?? []).filter((i) => i.id !== itemId)
    );

  // 8) บันทึกยอดจ่ายจริงหลังจบทริป
  const saveActualSpend = async (trip: SavedTrip, raw: string) => {
    const value = raw.trim() === '' ? null : Math.max(0, parseNum(raw));
    try {
      await updateDoc(doc(db, 'trips', trip.id), { actualSpend: value });
      return true;
    } catch {
      setTripsError(true);
      return false;
    }
  };

  const doneCount = savedTrips.filter((t) => t.status === 'done').length;
  const totalDistanceAll = savedTrips.reduce(
    (sum, t) => sum + (t.totalDistanceKm || 0),
    0
  );
  const totalSpendAll = savedTrips.reduce(
    (sum, t) => sum + (t.grandTotal || 0),
    0
  );

  return (
    <div className="min-h-screen bg-slate-100 transition-colors dark:bg-slate-50">
      {/* Toast */}
      <div
        className={`pointer-events-none fixed left-1/2 top-6 z-[1300] -translate-x-1/2 transition-all duration-300 ${
          toast
            ? 'translate-y-0 opacity-100'
            : '-translate-y-3 opacity-0'
        }`}
      >
        <div className="flex items-center gap-2 rounded-full bg-slate-900/90 px-5 py-2.5 text-sm font-semibold text-white shadow-xl backdrop-blur-sm">
          <CheckCircle2 size={16} className="text-emerald-400" />
          {toast || ' '}
        </div>
      </div>
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-slate-200/60 bg-slate-100/90 shadow-sm backdrop-blur-md transition-colors dark:bg-slate-50/90">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-teal-500 to-teal-700 text-white shadow-md shadow-teal-600/25">
              <RouteIcon size={20} strokeWidth={2.4} />
            </div>
            <div>
              <h1 className="text-base font-bold leading-tight text-slate-900 sm:text-lg">
                Trip Planner
              </h1>
              <p className="text-xs text-slate-500">วางแผนการเดินทาง & คำนวณค่าใช้จ่าย</p>
            </div>
          </div>
          <button
            onClick={resetAll}
            className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800 active:scale-95 sm:text-sm dark:border-slate-200 dark:bg-slate-100 dark:text-slate-600 dark:hover:bg-slate-200"
          >
            <RotateCcw size={15} />
            <span className="hidden sm:inline">รีเซ็ต</span>
          </button>
          <button
            onClick={toggleTheme}
            aria-label={dark ? 'สลับเป็นโหมดสว่าง' : 'สลับเป็นโหมดมืด'}
            title={dark ? 'โหมดสว่าง' : 'โหมดมืด'}
            className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 active:scale-95 dark:border-slate-200 dark:bg-slate-100 dark:text-amber-300 dark:hover:bg-slate-200"
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </header>

      {/* Tab navigation — Pill Tabs */}
      <nav
        aria-label="เมนูหลัก"
        className="mx-auto max-w-7xl px-4 pt-4 sm:px-6"
      >
        <div
          role="tablist"
          className="flex w-full gap-1 rounded-full border border-slate-200 bg-white p-1 shadow-sm sm:inline-flex sm:w-auto"
        >
          {(
            [
              { key: 'plan', label: 'วางแผนทริป', Icon: MapPinned },
              {
                key: 'saved',
                label: `ทริปที่บันทึกไว้${savedTrips.length > 0 ? ` (${savedTrips.length})` : ''}`,
                Icon: FolderOpen,
              },
            ] as const
          ).map(({ key, label, Icon }) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2 text-xs font-bold transition active:scale-[0.97] sm:flex-none sm:px-5 sm:text-sm ${
                tab === key
                  ? 'bg-teal-600 text-white shadow-sm'
                  : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
              }`}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>
      </nav>

      {/* แท็บที่ 1: วางแผนทริป — ซ่อนด้วย hidden แทนการ unmount เพื่อไม่ให้ข้อมูลที่กรอกค้างไว้หาย */}
      <main
        className={`mx-auto max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[420px_1fr] lg:items-start ${
          tab === 'plan' ? 'grid' : 'hidden'
        }`}
      >
        {/* ============ Left: Form ============ */}
        <div className="space-y-5">
          {/* Route card */}
          <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-sky-50 text-sky-600">
                <MapPinned size={17} />
              </span>
              <h2 className="text-sm font-bold text-slate-900">เส้นทางการเดินทาง</h2>
            </div>

            <div className="space-y-4">
              <Field label="จุดเริ่มต้น" icon={<MapPin size={15} className="text-emerald-600" />}>
                <input
                  value={origin}
                  onChange={(e) => setOrigin(e.target.value)}
                  placeholder="เช่น เมืองร้อยเอ็ด"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-sm outline-none transition focus:border-teal-500 focus:bg-white focus:ring-2 focus:ring-teal-500/20"
                />
                {isNotFound(origin) && <NotFoundWarning />}
              </Field>

              {/* Stops */}
              {days.length > 0 && (
                <div className="space-y-3">
                  {days.map((day, di) => (
                    <div
                      key={day.id}
                      className="rounded-xl border border-slate-200 bg-slate-50/60 p-3"
                    >
                      <div className="mb-2.5 flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-xs font-bold text-sky-700">
                          <CalendarDays size={14} />
                          วันที่ {di + 1}
                        </span>
                        <button
                          onClick={() => removeDay(day.id)}
                          className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-400 transition hover:bg-rose-50 hover:text-rose-500 active:scale-95"
                          aria-label={`ลบวันที่ ${di + 1}`}
                        >
                          <Trash2 size={13} />
                          ลบวัน
                        </button>
                      </div>
                      <div className="space-y-2.5">
                        {day.stops.map((stop, si) => (
                          <div key={stop.id}>
                            <div className="flex items-center gap-2">
                              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-sky-400 text-[10px] font-bold text-white shadow">
                                {si + 1}
                              </span>
                              <input
                                value={stop.name}
                                onChange={(e) => updateStop(day.id, stop.id, e.target.value)}
                                placeholder={`จุดแวะพักที่ ${si + 1}`}
                                className="w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
                              />
                              <button
                                onClick={() => removeStop(day.id, stop.id)}
                                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-300 transition hover:bg-rose-50 hover:text-rose-500 active:scale-90"
                                aria-label="ลบจุดแวะพัก"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                            {isNotFound(stop.name) && (
                              <div className="pl-7">
                                <NotFoundWarning />
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={() => addStop(day.id)}
                        className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-sky-200 py-2 text-xs font-semibold text-sky-600 transition hover:border-sky-300 hover:bg-sky-50 active:scale-[0.98]"
                      >
                        <Plus size={14} />
                        เพิ่มจุดแวะ
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={addDay}
                className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-sky-200 py-2.5 text-sm font-semibold text-sky-600 transition hover:border-sky-300 hover:bg-sky-50 active:scale-[0.98]"
              >
                <Plus size={16} />
                {days.length === 0 ? 'เพิ่มจุดแวะพัก' : 'เพิ่มวันถัดไป'}
              </button>

              <Field label="จุดหมายปลายทาง" icon={<Navigation size={15} className="text-rose-600" />}>
                <input
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder="กรอกจุดหมายปลายทาง เช่น เชียงใหม่, น่าน"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-sm outline-none transition focus:border-rose-500 focus:bg-white focus:ring-2 focus:ring-rose-500/20"
                />
                {isNotFound(destination) && <NotFoundWarning />}
              </Field>

              {/* Round-trip toggle */}
              <label className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 transition hover:border-teal-300">
                <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <Repeat size={16} className="text-teal-600" />
                  คำนวณแบบไป-กลับ
                </span>
                <span
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                    roundTrip ? 'bg-teal-600' : 'bg-slate-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={roundTrip}
                    onChange={(e) => setRoundTrip(e.target.checked)}
                    className="peer sr-only"
                  />
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                      roundTrip ? 'left-[22px]' : 'left-0.5'
                    }`}
                  />
                </span>
              </label>
            </div>
          </section>

          {/* Vehicle card */}
          <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-teal-50 text-teal-600">
                <CarFront size={17} />
              </span>
              <h2 className="text-sm font-bold text-slate-900">ข้อมูลยานพาหนะ</h2>
            </div>

            <div className="space-y-4">
              <Field label="ชื่อรถ" icon={<Car size={15} className="text-slate-400" />}>
                <input
                  value={carName}
                  onChange={(e) => setCarName(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-sm outline-none transition focus:border-teal-500 focus:bg-white focus:ring-2 focus:ring-teal-500/20"
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="สิ้นเปลือง (กม./ลิตร)">
                  <div className="relative">
                    <Fuel size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="number"
                      min="1"
                      value={fuelEfficiency}
                      onChange={(e) => setFuelEfficiency(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50/60 py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-teal-500 focus:bg-white focus:ring-2 focus:ring-teal-500/20"
                    />
                  </div>
                </Field>
                <Field label="ราคาน้ำมัน (บาท/ลิตร)">
                  <div className="relative">
                    <Coins size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="number"
                      min="0"
                      value={fuelPrice}
                      onChange={(e) => setFuelPrice(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50/60 py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-teal-500 focus:bg-white focus:ring-2 focus:ring-teal-500/20"
                    />
                  </div>
                </Field>
              </div>
            </div>
          </section>

          {/* Other expenses card */}
          <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-amber-50 text-amber-600">
                <Receipt size={17} />
              </span>
              <h2 className="text-sm font-bold text-slate-900">ค่าใช้จ่ายอื่นๆ (ต่อทริป)</h2>
            </div>

            <div className="space-y-4">
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                  <Tent size={15} className="text-slate-400" />
                  ค่าที่พัก (บาท)
                </div>
                <div className="space-y-2">
                  {nights.map((night) => (
                    <div key={night.id} className="flex items-center gap-2">
                      <span className="w-16 shrink-0 rounded-lg bg-amber-50 px-2 py-2.5 text-center text-xs font-bold text-amber-700">
                        {night.label}
                      </span>
                      <div className="relative flex-1">
                        <input
                          type="number"
                          min="0"
                          placeholder="0"
                          value={night.amount}
                          onChange={(e) => updateNightAmount(night.id, e.target.value)}
                          className="w-full rounded-xl border border-slate-200 bg-slate-50/60 py-2.5 pl-8 pr-3 text-sm outline-none transition focus:border-amber-500 focus:bg-white focus:ring-2 focus:ring-amber-500/20"
                        />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                          ฿
                        </span>
                      </div>
                      <button
                        onClick={() => removeNight(night.id)}
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-300 transition hover:bg-rose-50 hover:text-rose-500 active:scale-90"
                        aria-label="ลบคืนนี้"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={addNight}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-amber-200 py-2 text-xs font-semibold text-amber-600 transition hover:border-amber-300 hover:bg-amber-50 active:scale-[0.98]"
                  >
                    <Plus size={14} />
                    เพิ่มคืนที่ {nights.length + 1}
                  </button>
                </div>
              </div>
              <Field label="ค่าอาหารและจิปาถะ (บาท)">
                <div className="relative">
                  <UtensilsCrossed size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="number"
                    min="0"
                    value={food}
                    onChange={(e) => setFood(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50/60 py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-amber-500 focus:bg-white focus:ring-2 focus:ring-amber-500/20"
                  />
                </div>
              </Field>
              <Field label="จำนวนผู้เดินทาง (คน)">
                <div className="relative">
                  <Users size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="number"
                    min="1"
                    value={travelers}
                    onChange={(e) => setTravelers(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50/60 py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20"
                  />
                </div>
              </Field>
            </div>
          </section>
        </div>

        {/* ============ Right: Map + Summary ============ */}
        <div className="space-y-5 lg:sticky lg:top-[84px]">
          {/* Map */}
          <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <div className="flex items-center justify-between px-5 pb-3 pt-4">
              <div className="flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-50 text-slate-600">
                  <MapPinned size={17} />
                </span>
                <h2 className="text-sm font-bold text-slate-900">แผนที่เส้นทาง</h2>
              </div>
              {routing ? (
                <span className="flex items-center gap-1.5 rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-600">
                  <Loader2 size={12} className="animate-spin" />
                  กำลังคำนวณเส้นทาง...
                </span>
              ) : (
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
                  {routePlaces.filter((p) => p.trim()).length} จุดแวะ
                </span>
              )}
            </div>
            <div className="relative h-[300px] w-full sm:h-[380px]">
              {/* Weather widget — glassmorphism มุมบนซ้ายของแผนที่ */}
              <div className="pointer-events-none absolute left-3 top-3 z-[500]">
                {weather ? (
                  (() => {
                    const { Icon, label } = weatherMeta(weather.code);
                    return (
                      <div className="flex items-center gap-3 rounded-2xl border border-white/50 bg-white/25 px-4 py-2.5 shadow-lg backdrop-blur-md">
                        <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/40 text-slate-700">
                          <Icon size={22} />
                        </span>
                        <div>
                          <p className="text-lg font-extrabold leading-tight text-slate-800 drop-shadow-sm">
                            {Math.round(weather.temp)}°C
                          </p>
                          <p className="text-[11px] font-semibold text-slate-600">
                            {label} · ฝนตก {weather.rainProb}%
                          </p>
                        </div>
                      </div>
                    );
                  })()
                ) : weatherError && destination.trim() ? (
                  <div className="flex items-center gap-1.5 rounded-2xl border border-white/50 bg-white/25 px-3 py-2 text-[11px] font-semibold text-slate-600 shadow backdrop-blur-md">
                    <AlertTriangle size={12} />
                    ไม่สามารถโหลดสภาพอากาศได้
                  </div>
                ) : destination.trim() ? (
                  <div className="flex items-center gap-1.5 rounded-2xl border border-white/50 bg-white/25 px-3 py-2 text-[11px] font-semibold text-slate-600 shadow backdrop-blur-md">
                    <Loader2 size={12} className="animate-spin" />
                    กำลังโหลดสภาพอากาศ...
                  </div>
                ) : null}
              </div>
              <MapContainer
                center={[16.4, 101.6]}
                zoom={7}
                scrollWheelZoom={false}
                className="h-full w-full"
              >
                <TileLayer
                  key={dark ? 'dark' : 'light'}
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url={
                    dark
                      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
                      : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
                  }
                />
                <FitBounds coords={mapLine ?? NO_COORDS} active={tab === 'plan'} />
                {route && (
                  <>
                    <Polyline
                      positions={route.line}
                      pathOptions={{ color: '#ffffff', weight: 12, opacity: 0.35, lineCap: 'round' }}
                    />
                    <Polyline
                      positions={route.line}
                      pathOptions={{ color: dark ? '#D4AE82' : '#4A6B5D', weight: 4, opacity: 0.9 }}
                    />
                  </>
                )}
                {!route && mapLine && (
                  <Polyline
                    positions={mapLine}
                    pathOptions={{
                      color: dark ? '#A3B0AA' : '#635D52',
                      weight: 3,
                      opacity: 0.5,
                      dashArray: '8 10',
                    }}
                  />
                )}
                {routePlaces.map((place, i) => {
                  const coord = place.trim() ? geoResults[place.trim()] : undefined;
                  if (!coord) return null;
                  const isStart = i === 0;
                  const isEnd = i === routePlaces.length - 1;
                  return (
                    <Marker
                      key={`${place}-${i}`}
                      position={[coord.lat, coord.lon]}
                      icon={
                        isStart
                          ? pinIcon(getComputedStyle(document.documentElement).getPropertyValue('--pin-start').trim() || '#4A6B5D', '', 'start')
                          : isEnd
                            ? pinIcon(getComputedStyle(document.documentElement).getPropertyValue('--pin-end').trim() || '#B5533C', '', 'end')
                            : pinIcon(getComputedStyle(document.documentElement).getPropertyValue('--pin-stop').trim() || '#8F6840', String(i), 'stop')
                      }
                    >
                      <Popup>
                        <strong>{place.trim()}</strong>
                        <br />
                        {isStart
                          ? 'จุดเริ่มต้น'
                          : isEnd
                            ? 'จุดหมายปลายทาง'
                            : `วันที่ ${routeMeta[i].day} - จุดแวะที่ ${routeMeta[i].stopNo}`}
                      </Popup>
                    </Marker>
                  );
                })}
              </MapContainer>
            </div>
            {googleMapsUrl && (
              <div className="px-5 pb-4 pt-3">
                <a
                  href={googleMapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-700 active:scale-[0.98]"
                >
                  <Navigation size={16} />
                  นำทางด้วย Google Maps
                  <ExternalLink size={14} className="opacity-70" />
                </a>
              </div>
            )}
          </section>

          {/* Summary */}
          <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <div className="flex items-center gap-2 px-5 pb-3 pt-4">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-50 text-emerald-600">
                <Wallet size={17} />
              </span>
              <h2 className="text-sm font-bold text-slate-900">สรุปยอดค่าใช้จ่าย</h2>
            </div>

            <div className="px-5 pb-5">
              {routeStatus === 'error' && (
                <p className="mb-3 flex items-center gap-1.5 rounded-xl bg-rose-50 px-3 py-2 text-xs font-medium text-rose-600">
                  <AlertTriangle size={13} />
                  ไม่สามารถคำนวณเส้นทางได้ กรุณาตรวจสอบชื่อสถานที่อีกครั้ง
                </p>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-sky-100 text-sky-600">
                    <RouteIcon size={18} />
                  </span>
                  <div>
                    <p className="text-xs text-slate-500">ระยะทางรวมทั้งหมด{roundTrip ? ' (ไป-กลับ)' : ''}</p>
                    {totalDistanceKm !== null ? (
                      <p className="text-lg font-bold text-slate-900">
                        {fmtNum(totalDistanceKm)}{' '}
                        <span className="text-sm font-medium text-slate-500">กม.</span>
                      </p>
                    ) : (
                      <p className="text-lg font-bold text-slate-400">-- กม.</p>
                    )}
                    {driveMinutes !== null && (
                      <p className="flex items-center gap-1 text-[11px] text-slate-400">
                        <Clock size={11} />
                        ขับรถประมาณ {Math.floor(driveMinutes / 60)} ชม. {Math.round(driveMinutes % 60)} นาที
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-teal-100 text-teal-600">
                    <Fuel size={18} />
                  </span>
                  <div>
                    <p className="text-xs text-slate-500">ค่าน้ำมันโดยประมาณ</p>
                    {fuelCost !== null ? (
                      <>
                        <p className="text-lg font-bold text-slate-900">{fmtBaht(fuelCost)}</p>
                        <p className="text-[11px] text-slate-400">
                          ใช้น้ำมันประมาณ {fmtNum(fuelLiters!)} ลิตร
                        </p>
                      </>
                    ) : (
                      <p className="text-lg font-bold text-slate-400">-- ฿</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-600">
                    <Tent size={18} />
                  </span>
                  <div>
                    <p className="text-xs text-slate-500">ค่าที่พัก ({nights.length} คืน)</p>
                    <p className="text-lg font-bold text-slate-900">{fmtBaht(stayCost)}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-orange-100 text-orange-600">
                    <UtensilsCrossed size={18} />
                  </span>
                  <div>
                    <p className="text-xs text-slate-500">ค่าอาหารและจิปาถะ</p>
                    <p className="text-lg font-bold text-slate-900">{fmtBaht(foodCost)}</p>
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 p-5 text-white shadow-md shadow-emerald-600/25">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-emerald-100">ยอดรวมค่าใช้จ่ายทั้งทริป</p>
                    <p className="mt-0.5 text-3xl font-extrabold tracking-tight">
                      {fmtBaht(grandTotal)}
                    </p>
                    {perPerson !== null && (
                      <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-emerald-100">
                        <Users size={14} />
                        เฉลี่ยคนละ {fmtBaht(perPerson)}
                      </p>
                    )}
                  </div>
                  {expenseData.length > 0 ? (
                    <div className="flex items-center gap-3">
                      <div className="h-[110px] w-[110px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={expenseData}
                              dataKey="value"
                              innerRadius={30}
                              outerRadius={52}
                              paddingAngle={2}
                              strokeWidth={0}
                            >
                              {expenseData.map((d) => (
                                <Cell key={d.name} fill={d.color} />
                              ))}
                            </Pie>
                            <Tooltip
                              formatter={(v, name) => [fmtBaht(Number(v)), String(name)]}
                              contentStyle={{
                                borderRadius: 12,
                                border: 'none',
                                fontSize: 12,
                                backgroundColor: 'rgb(var(--c-slate-100))',
                                color: 'rgb(var(--c-slate-900))',
                                boxShadow: '0 10px 25px -5px rgb(15 23 42 / 0.25)',
                              }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="space-y-1.5">
                        {expenseData.map((d) => (
                          <div key={d.name} className="flex items-center gap-2 text-xs">
                            <span
                              className="h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: d.color }}
                            />
                            <span className="text-emerald-100">{d.name}</span>
                            <span className="font-bold">
                              {grandTotal > 0 ? Math.round((d.value / grandTotal) * 100) : 0}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <p className="mt-3 text-center text-[11px] text-slate-400">
                ระยะทางจากเส้นทางขับรถจริง (OSRM) · ค่าใช้จ่ายเป็นค่าโดยประมาณ
              </p>

              <div className="mt-4 flex gap-3">
                <button
                  onClick={() => setShowSaveModal(true)}
                  disabled={totalDistanceKm === null}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-teal-600 bg-white py-2.5 text-sm font-bold text-teal-700 shadow-sm transition hover:bg-teal-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Save size={16} />
                  บันทึกทริปนี้
                </button>
                <button
                  onClick={copyTripSummary}
                  disabled={totalDistanceKm === null}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#06c755] py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-[#05b04b] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Copy size={16} />
                  คัดลอกสรุปทริป
                </button>
              </div>
              <p className="mt-2 text-center text-[11px] text-slate-400">
                บันทึกลงระบบคลาวด์ — ทุกคนที่เปิดลิงก์นี้จะเห็นทริปชุดเดียวกัน
              </p>
            </div>
          </section>
        </div>
      </main>

      {/* ============ Saved trips (แท็บที่ 2) ============ */}
      <section
        hidden={tab !== 'saved'}
        className="mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6 max-sm:pb-24"
      >
        <div className="mb-4 flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-50 text-emerald-600">
            <FolderOpen size={17} />
          </span>
          <h2 className="text-sm font-bold text-slate-900">ประวัติทริปที่บันทึกไว้</h2>
          {savedTrips.length > 0 && (
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
              {savedTrips.length}
            </span>
          )}
        </div>

        {/* Travel stats — สรุปสะสมจากทริปทั้งหมด */}
        {!tripsError && !tripsLoading && savedTrips.length > 0 && (
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm max-sm:flex-col max-sm:gap-1.5 max-sm:px-3 max-sm:py-3 max-sm:text-center">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-50 text-sky-600 max-sm:h-9 max-sm:w-9">
                <Flag size={18} />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] text-slate-500">ทริปที่ไปมาแล้ว</p>
                <p className="whitespace-nowrap text-lg font-extrabold text-slate-900 max-sm:text-base">{doneCount} ทริป</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm max-sm:flex-col max-sm:gap-1.5 max-sm:px-3 max-sm:py-3 max-sm:text-center">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-600 max-sm:h-9 max-sm:w-9">
                <RouteIcon size={18} />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] text-slate-500">ระยะทางสะสมรวม</p>
                <p className="whitespace-nowrap text-lg font-extrabold text-slate-900 max-sm:text-base">
                  {fmtNum(totalDistanceAll, 0)} <span className="text-xs font-medium text-slate-500">กม.</span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm max-sm:flex-col max-sm:gap-1.5 max-sm:px-3 max-sm:py-3 max-sm:text-center">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-600 max-sm:h-9 max-sm:w-9">
                <Wallet size={18} />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] text-slate-500">งบเที่ยวสะสมทั้งหมด</p>
                <p className="whitespace-nowrap text-lg font-extrabold text-teal-700 max-sm:text-base">{fmtBaht(totalSpendAll)}</p>
              </div>
            </div>
          </div>
        )}

        {tripsError ? (
          <div className="rounded-2xl border-2 border-dashed border-rose-200 bg-rose-50/60 px-6 py-12 text-center">
            <AlertTriangle size={32} className="mx-auto mb-3 text-rose-300" />
            <p className="text-sm font-semibold text-rose-600">
              ไม่สามารถโหลดข้อมูลทริปจากระบบได้ กรุณาลองใหม่อีกครั้ง
            </p>
          </div>
        ) : tripsLoading ? (
          <div className="flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 bg-white/60 px-6 py-12">
            <Loader2 size={18} className="animate-spin text-teal-600" />
            <p className="text-sm font-semibold text-slate-500">กำลังโหลดทริปที่บันทึกไว้...</p>
          </div>
        ) : savedTrips.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white/60 px-6 py-12 text-center">
            <FolderOpen size={32} className="mx-auto mb-3 text-slate-300" />
            <p className="text-sm font-semibold text-slate-500">
              ยังไม่มีทริปที่บันทึกไว้
            </p>
            <p className="mt-1 text-xs text-slate-400">
              ลองวางแผนเส้นทางแล้วกดบันทึกดูสิ!
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {savedTrips.map((trip) => {
              const photos = trip.photos ?? [];
              const checklist = trip.checklist ?? [];
              const doneItems = checklist.filter((i) => i.done).length;
              const actual = trip.actualSpend;
              const diff = actual !== null && actual !== undefined ? trip.grandTotal - actual : null;
              return (
              <article
                key={trip.id}
                className="flex flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm transition hover:shadow-md"
              >
                {photos.length > 0 && (
                  <div className="relative">
                    <button
                      onClick={() => setLightbox({ trip, index: 0 })}
                      className="block h-40 w-full cursor-zoom-in bg-slate-100"
                    >
                      <img
                        src={photos[0]}
                        alt={`รูปทริป ${trip.name}`}
                        className="h-40 w-full object-cover"
                      />
                    </button>
                    {photos.length > 1 && (
                      <div className="absolute bottom-2 left-2 flex gap-1.5">
                        {photos.slice(1, 5).map((p, i) => (
                          <button
                            key={i}
                            onClick={() => setLightbox({ trip, index: i + 1 })}
                            className="overflow-hidden rounded-lg border-2 border-white shadow-md transition hover:scale-105"
                          >
                            <img src={p} alt="" className="h-11 w-11 object-cover" />
                          </button>
                        ))}
                        <span className="grid h-11 w-11 place-items-center rounded-lg bg-slate-900/70 text-xs font-bold text-white">
                          {photos.length}
                        </span>
                      </div>
                    )}
                  </div>
                )}
                <div className="flex flex-1 flex-col p-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">{trip.name}</h3>
                    {trip.travelDate && (
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                        <CalendarDays size={12} />
                        {new Date(trip.travelDate + 'T00:00:00').toLocaleDateString('th-TH', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        })}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      onClick={() => toggleTripStatus(trip)}
                      title="กดเพื่อสลับสถานะ"
                      className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold transition active:scale-90 ${
                        trip.status === 'done'
                          ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                          : 'bg-sky-100 text-sky-700 hover:bg-sky-200'
                      }`}
                    >
                      {trip.status === 'done' ? (
                        <>
                          <Check size={11} />
                          ไปมาแล้ว
                        </>
                      ) : (
                        <>
                          <ClipboardList size={11} />
                          กำลังวางแผน
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => deleteTrip(trip.id)}
                      disabled={deletingId === trip.id}
                      className="grid h-8 w-8 place-items-center rounded-lg text-slate-300 transition hover:bg-rose-50 hover:text-rose-500 active:scale-90 disabled:opacity-40"
                      aria-label="ลบทริป"
                    >
                      {deletingId === trip.id ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        <Trash2 size={15} />
                      )}
                    </button>
                  </div>
                </div>

                <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-600">
                  <MapPin size={13} className="shrink-0 text-emerald-600" />
                  <span className="truncate">
                    {trip.origin || '—'} → {trip.destination || '—'}
                  </span>
                </p>

                <div className="mt-3 flex items-center gap-4 rounded-xl bg-slate-50 px-3 py-2.5">
                  <div>
                    <p className="text-[11px] text-slate-500">ระยะทาง</p>
                    <p className="text-sm font-bold text-slate-800">
                      {fmtNum(trip.totalDistanceKm)} กม.
                    </p>
                  </div>
                  <div className="h-8 w-px bg-slate-200" />
                  <div>
                    <p className="text-[11px] text-slate-500">ยอดรวม</p>
                    <p className="text-sm font-extrabold text-teal-700">
                      {fmtBaht(trip.grandTotal)}
                    </p>
                  </div>
                </div>

                {/* แถบเปรียบเทียบงบที่ตั้งไว้ vs จ่ายจริง */}
                {actual != null && diff !== null && (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                    <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500">
                      <span>จ่ายจริง {fmtBaht(actual)}</span>
                      <span>งบ {fmtBaht(trip.grandTotal)}</span>
                    </div>
                    <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full ${diff >= 0 ? 'bg-emerald-500' : 'bg-rose-500'}`}
                        style={{
                          width: `${Math.min(100, (actual / Math.max(1, trip.grandTotal)) * 100)}%`,
                        }}
                      />
                    </div>
                    <p
                      className={`mt-1.5 flex items-center gap-1 text-[11px] font-bold ${
                        diff >= 0 ? 'text-emerald-600' : 'text-rose-600'
                      }`}
                    >
                      <BadgePercent size={12} />
                      {diff >= 0
                        ? `ประหยัดกว่างบ ${fmtBaht(diff)}`
                        : `เกินงบไป ${fmtBaht(-diff)}`}
                    </p>
                  </div>
                )}

                {trip.note && (
                  <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-slate-500">
                    “{trip.note}”
                  </p>
                )}

                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => {
                      setChecklistId(checklistId === trip.id ? null : trip.id);
                      setNewItemText('');
                    }}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2 text-xs font-semibold text-slate-600 transition hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700 active:scale-[0.98]"
                  >
                    <ClipboardList size={14} />
                    เช็กลิสต์
                    {checklist.length > 0 && (
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                          doneItems === checklist.length && checklist.length > 0
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-sky-100 text-sky-700'
                        }`}
                      >
                        {doneItems}/{checklist.length}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setSpendId(spendId === trip.id ? null : trip.id);
                      setSpendInput(actual != null ? String(actual) : '');
                    }}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2 text-xs font-semibold text-slate-600 transition hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700 active:scale-[0.98]"
                  >
                    <Wallet size={14} />
                    บันทึกยอดจ่ายจริง
                  </button>
                </div>

                {spendId === trip.id && (
                  <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                    <label className="block text-[11px] font-semibold text-slate-600">
                      ยอดเงินที่จ่ายไปจริงทั้งทริป (บาท)
                    </label>
                    <div className="mt-1.5 flex gap-2">
                      <input
                        type="number"
                        min="0"
                        value={spendInput}
                        onChange={(e) => setSpendInput(e.target.value)}
                        placeholder="เช่น 3200"
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                      />
                      <button
                        onClick={async () => {
                          const ok = await saveActualSpend(trip, spendInput);
                          if (ok) setSpendId(null);
                        }}
                        className="shrink-0 rounded-lg bg-teal-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-teal-700 active:scale-[0.98]"
                      >
                        บันทึก
                      </button>
                    </div>
                  </div>
                )}

                <button
                  onClick={() => loadTrip(trip)}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-teal-700 active:scale-[0.98]"
                >
                  <FolderOpen size={14} />
                  เปิดดู / โหลดทริป
                </button>

                {checklistId === trip.id && (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                    <div className="space-y-1.5">
                      {checklist.length === 0 && (
                        <p className="py-1 text-center text-[11px] text-slate-400">
                          ยังไม่มีรายการ เพิ่มรายการแรกเลย!
                        </p>
                      )}
                      {checklist.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center gap-2 rounded-lg bg-white px-2.5 py-1.5"
                        >
                          <button
                            onClick={() =>
                              void updateChecklist(
                                trip,
                                checklist.map((i) =>
                                  i.id === item.id ? { ...i, done: !i.done } : i
                                )
                              )
                            }
                            className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border-2 transition ${
                              item.done
                                ? 'border-emerald-500 bg-emerald-500 text-white'
                                : 'border-slate-300 bg-white hover:border-emerald-400'
                            }`}
                            aria-label="ติ๊กว่าเตรียมแล้ว"
                          >
                            {item.done && <Check size={12} strokeWidth={3} />}
                          </button>
                          <span
                            className={`flex-1 text-xs ${
                              item.done
                                ? 'text-slate-400 line-through'
                                : 'text-slate-700'
                            }`}
                          >
                            {item.text}
                          </span>
                          <button
                            onClick={() => removeChecklistItem(trip, item.id)}
                            className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-slate-300 transition hover:bg-rose-50 hover:text-rose-500"
                            aria-label="ลบรายการ"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 flex gap-2">
                      <input
                        value={newItemText}
                        onChange={(e) => setNewItemText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') addChecklistItem(trip);
                        }}
                        placeholder="เพิ่มรายการใหม่..."
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                      />
                      <button
                        onClick={() => addChecklistItem(trip)}
                        className="shrink-0 rounded-lg bg-teal-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-teal-700 active:scale-[0.98]"
                        aria-label="เพิ่มรายการ"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                    <p className="mt-1.5 text-center text-[10px] text-slate-400">
                      แก้ไขแล้วบันทึกอัตโนมัติ
                    </p>
                  </div>
                )}

                <button
                  onClick={() => {
                    setEditPhotosId(editPhotosId === trip.id ? null : trip.id);
                    setEditPhotos(photos);
                    setPhotoError('');
                  }}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 py-2 text-xs font-semibold text-slate-600 transition hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700 active:scale-[0.98]"
                >
                  <ImagePlus size={14} />
                  เพิ่ม/แก้ไขรูปภาพ ({photos.length}/{MAX_PHOTOS})
                </button>

                {editPhotosId === trip.id && (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                    {editPhotos.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-2">
                        {editPhotos.map((p, i) => (
                          <div key={i} className="relative">
                            <img src={p} alt="" className="h-16 w-16 rounded-lg object-cover" />
                            <button
                              onClick={() => setEditPhotos(editPhotos.filter((_, j) => j !== i))}
                              className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-rose-500 text-white shadow"
                              aria-label="ถอดรูปออก"
                            >
                              <X size={11} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <label
                      className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-slate-200 py-2 text-xs font-semibold text-slate-500 transition hover:border-teal-300 hover:text-teal-600 ${
                        (processingPhotos || editPhotos.length >= MAX_PHOTOS) && 'pointer-events-none opacity-40'
                      }`}
                    >
                      {processingPhotos ? (
                        <>
                          <Loader2 size={13} className="animate-spin" />
                          กำลังย่อรูป...
                        </>
                      ) : (
                        <>
                          <ImagePlus size={13} />
                          เพิ่มรูป (เหลืออีก {MAX_PHOTOS - editPhotos.length} รูป)
                        </>
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="sr-only"
                        onChange={(e) => {
                          addPhotos(e.target.files, editPhotos, setEditPhotos);
                          e.target.value = '';
                        }}
                      />
                    </label>
                    <button
                      onClick={async () => {
                        const ok = await saveTripPhotos(trip.id, editPhotos);
                        if (ok) setEditPhotosId(null);
                      }}
                      className="mt-2 w-full rounded-lg bg-teal-600 py-1.5 text-xs font-bold text-white transition hover:bg-teal-700 active:scale-[0.98]"
                    >
                      บันทึกรูปภาพ
                    </button>
                  </div>
                )}
                </div>
              </article>
              );
            })}
          </div>
        )}
      </section>

      {/* ============ Save modal ============ */}
      {showSaveModal && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm"
          onClick={() => setShowSaveModal(false)}
        >
          <div
            className="my-auto w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl max-sm:p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
                <Save size={18} className="text-teal-600" />
                บันทึกทริปนี้
              </h3>
              <button
                onClick={() => setShowSaveModal(false)}
                className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                aria-label="ปิดหน้าต่าง"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-4">
              <Field label="ชื่อทริป">
                <input
                  value={tripName}
                  onChange={(e) => setTripName(e.target.value)}
                  placeholder="เช่น ทริปน่าน ปลายปี 69"
                  autoFocus
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-sm outline-none transition focus:border-teal-500 focus:bg-white focus:ring-2 focus:ring-teal-500/20"
                />
              </Field>
              <Field label="วันที่เดินทาง">
                <input
                  type="date"
                  value={travelDate}
                  onChange={(e) => setTravelDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-sm outline-none transition focus:border-teal-500 focus:bg-white focus:ring-2 focus:ring-teal-500/20"
                />
              </Field>
              <Field label="บันทึกความทรงจำ / โน้ตสั้นๆ">
                <textarea
                  value={tripNote}
                  onChange={(e) => setTripNote(e.target.value)}
                  rows={3}
                  placeholder="เช่น ไปพร้อมฝนหมาก ๆ แต่สนุกมาก"
                  className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-sm outline-none transition focus:border-teal-500 focus:bg-white focus:ring-2 focus:ring-teal-500/20"
                />
              </Field>

              <Field label="รูปภาพระหว่างทริป (สูงสุด 4 รูป)">
                <div className="space-y-2">
                  {modalPhotos.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {modalPhotos.map((p, i) => (
                        <div key={i} className="relative">
                          <img src={p} alt="" className="h-16 w-16 rounded-lg object-cover" />
                          <button
                            onClick={() =>
                              setModalPhotos(modalPhotos.filter((_, j) => j !== i))
                            }
                            className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-rose-500 text-white shadow"
                            aria-label="ถอดรูปออก"
                          >
                            <X size={11} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {modalPhotos.length < MAX_PHOTOS && (
                    <label
                      className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 py-3 text-xs font-semibold text-slate-500 transition hover:border-teal-300 hover:text-teal-600 ${
                        processingPhotos && 'pointer-events-none opacity-40'
                      }`}
                    >
                      {processingPhotos ? (
                        <>
                          <Loader2 size={14} className="animate-spin" />
                          กำลังย่อรูป...
                        </>
                      ) : (
                        <>
                          <ImagePlus size={14} />
                          เลือกรูปจากเครื่อง (ย่อขนาดอัตโนมัติ)
                        </>
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="sr-only"
                        onChange={(e) => {
                          addPhotos(e.target.files, modalPhotos, setModalPhotos);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  )}
                </div>
              </Field>

              <div className="rounded-xl bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
                จะบันทึก: {origin.trim() || '—'} → {destination.trim() || '—'} ·{' '}
                {totalDistanceKm !== null ? `${fmtNum(totalDistanceKm)} กม.` : '--'} · ยอดรวม{' '}
                <strong>{fmtBaht(grandTotal)}</strong>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowSaveModal(false)}
                  className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 active:scale-[0.98]"
                >
                  ยกเลิก
                </button>
                <button
                  onClick={saveCurrentTrip}
                  disabled={savingTrip}
                  className="flex-1 rounded-xl bg-teal-600 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-teal-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingTrip ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 size={15} className="animate-spin" />
                      กำลังบันทึก...
                    </span>
                  ) : (
                    'บันทึกทริป'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============ Photo error toast ============ */}
      {photoError && (
        <div className="fixed bottom-4 left-1/2 z-[1100] -translate-x-1/2 rounded-full bg-rose-600 px-5 py-2.5 text-xs font-semibold text-white shadow-lg">
          {photoError}
        </div>
      )}

      {/* ============ Lightbox ============ */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[1050] flex flex-col bg-slate-950/90 backdrop-blur-sm"
          onClick={() => setLightbox(null)}
        >
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <p className="min-w-0 truncate text-sm font-semibold text-white">
              {lightbox.trip.name} · รูปที่ {lightbox.index + 1}/{lightbox.trip.photos.length}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removePhotoFromTrip(lightbox.trip, lightbox.index);
                }}
                className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rose-700 active:scale-95"
              >
                <Trash2 size={13} />
                ลบรูปนี้
              </button>
              <button
                onClick={() => setLightbox(null)}
                className="grid h-9 w-9 place-items-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white"
                aria-label="ปิด"
              >
                <X size={20} />
              </button>
            </div>
          </div>
          <div
            className="relative flex flex-1 items-center justify-center px-14 pb-10"
            onClick={(e) => e.stopPropagation()}
          >
            {lightbox.index > 0 && (
              <button
                onClick={() =>
                  setLightbox({ ...lightbox, index: lightbox.index - 1 })
                }
                className="absolute left-3 grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
                aria-label="รูปก่อนหน้า"
              >
                <ChevronLeft size={24} />
              </button>
            )}
            <img
              src={lightbox.trip.photos[lightbox.index]}
              alt=""
              className="max-h-full max-w-full rounded-xl object-contain shadow-2xl"
            />
            {lightbox.index < lightbox.trip.photos.length - 1 && (
              <button
                onClick={() =>
                  setLightbox({ ...lightbox, index: lightbox.index + 1 })
                }
                className="absolute right-3 grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
                aria-label="รูปถัดไป"
              >
                <ChevronRight size={24} />
              </button>
            )}
          </div>
          <div
            className="flex justify-center gap-2 pb-6"
            onClick={(e) => e.stopPropagation()}
          >
            {lightbox.trip.photos.map((p, i) => (
              <button
                key={i}
                onClick={() => setLightbox({ ...lightbox, index: i })}
                className={`overflow-hidden rounded-lg transition ${
                  i === lightbox.index
                    ? 'ring-2 ring-teal-400'
                    : 'opacity-50 hover:opacity-100'
                }`}
              >
                <img src={p} alt="" className="h-12 w-12 object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
        {icon}
        {label}
      </span>
      {children}
    </label>
  );
}

export default App;
