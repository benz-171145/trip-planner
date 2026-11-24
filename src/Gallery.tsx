import { useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from 'firebase/firestore';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  FolderOpen,
  ImagePlus,
  Images,
  Loader2,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { db, tripPhotosRef } from './firebase';

// ---------- Types & constants ----------

export type TripPhoto = {
  id: string;
  tripId: string;
  tripName: string;
  imageData: string;
  caption: string;
};

export type TripOption = { id: string; name: string };

export const MAX_PHOTOS_PER_TRIP = 6;
const MAX_SIDE = 1200;
const JPEG_QUALITY = 0.75;
const MAX_IMAGE_BYTES = 850_000; // เผื่อมาร์จินก่อนชนขีดจำกัด 1MiB ของเอกสาร Firestore

// ---------- Hook: ดึงรูปทั้งหมดแบบ real-time ----------

export function useTripPhotos() {
  const [photos, setPhotos] = useState<TripPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const q = query(tripPhotosRef, orderBy('createdAt', 'desc'));
    return onSnapshot(
      q,
      (snap) => {
        setPhotos(
          snap.docs.map((d) => {
            const x = d.data();
            return {
              id: d.id,
              tripId: String(x.tripId ?? ''),
              tripName: String(x.tripName ?? ''),
              imageData: String(x.imageData ?? ''),
              caption: String(x.caption ?? ''),
            };
          })
        );
        setLoading(false);
        setError(false);
      },
      (err) => {
        console.error('trip_photos listener failed:', err.code, err.message);
        setLoading(false);
        setError(true);
      }
    );
  }, []);

  return { photos, loading, error };
}

// ---------- ย่อรูปด้วย Canvas (≤1200px, JPEG 0.75) ----------

function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('decode failed'));
    };
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('canvas failed'));
      ctx.fillStyle = '#ffffff'; // PNG โปร่งใส → พื้นขาวแทนดำ
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      let q = JPEG_QUALITY;
      let data = canvas.toDataURL('image/jpeg', q);
      while (data.length * 0.75 > MAX_IMAGE_BYTES && q > 0.35) {
        q -= 0.1;
        data = canvas.toDataURL('image/jpeg', q);
      }
      if (data.length * 0.75 > MAX_IMAGE_BYTES) return reject(new Error('too large'));
      resolve(data);
    };
    img.src = url;
  });
}

type Draft = { key: number; data: string; caption: string };

// ---------- Gallery tab ----------

export function GalleryTab({
  photos,
  loading,
  error,
  trips,
  onToast,
}: {
  photos: TripPhoto[];
  loading: boolean;
  error: boolean;
  trips: TripOption[];
  onToast: (msg: string) => void;
}) {
  const [filter, setFilter] = useState<string>('all');
  const [showAdd, setShowAdd] = useState(false);
  const [viewer, setViewer] = useState<number | null>(null);

  const countByTrip = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of photos) m[p.tripId] = (m[p.tripId] ?? 0) + 1;
    return m;
  }, [photos]);

  // ถ้าทริปที่กรองอยู่ถูกลบ ให้กลับไปที่ "ทั้งหมด"
  const activeFilter = filter === 'all' || trips.some((t) => t.id === filter) ? filter : 'all';
  const visible = activeFilter === 'all' ? photos : photos.filter((p) => p.tripId === activeFilter);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-50 text-emerald-600">
            <Images size={17} />
          </span>
          <h2 className="text-sm font-bold text-slate-900">คลังรูปภาพ</h2>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 rounded-full bg-teal-600 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-teal-700 active:scale-95 sm:text-sm"
        >
          <Plus size={15} />
          เพิ่มรูปภาพ
        </button>
      </div>

      {/* แถบกรองตามทริป */}
      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {[{ id: 'all', name: 'ทั้งหมด', count: photos.length }, ...trips.map((t) => ({ ...t, count: countByTrip[t.id] ?? 0 }))].map(
          (f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-semibold transition active:scale-95 ${
                activeFilter === f.id
                  ? 'border-teal-600 bg-teal-600 text-white shadow-sm'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-teal-300 hover:text-teal-700'
              }`}
            >
              {f.name}
              <span className="ml-1.5 opacity-70">{f.count}</span>
            </button>
          )
        )}
      </div>

      {error ? (
        <div className="rounded-2xl border-2 border-dashed border-rose-200 bg-rose-50/60 px-6 py-12 text-center">
          <AlertTriangle size={32} className="mx-auto mb-3 text-rose-300" />
          <p className="text-sm font-semibold text-rose-600">
            ไม่สามารถโหลดรูปภาพจากระบบได้ กรุณาลองใหม่อีกครั้ง
          </p>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 bg-white/60 px-6 py-12">
          <Loader2 size={18} className="animate-spin text-teal-600" />
          <p className="text-sm font-semibold text-slate-500">กำลังโหลดรูปภาพ...</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white/60 px-6 py-12 text-center">
          <ImagePlus size={32} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm font-semibold text-slate-500">ยังไม่มีรูปภาพ</p>
          <p className="mt-1 text-xs text-slate-400">กด "เพิ่มรูปภาพ" เพื่อเก็บความทรงจำจากทริป</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          {visible.map((p, i) => (
            <figure
              key={p.id}
              className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-2 shadow-sm transition hover:shadow-md"
            >
              <button
                onClick={() => setViewer(i)}
                className="block aspect-[4/3] w-full cursor-zoom-in overflow-hidden rounded-xl bg-slate-100"
              >
                <img
                  src={p.imageData}
                  alt={p.caption || p.tripName}
                  loading="lazy"
                  className="h-full w-full object-cover transition duration-300 hover:scale-105"
                />
              </button>
              <figcaption className="px-1.5 pb-1 pt-2">
                <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-700">
                  <FolderOpen size={10} className="shrink-0" />
                  <span className="truncate">{p.tripName || 'ไม่ระบุทริป'}</span>
                </span>
                {p.caption && (
                  <p className="mt-1 line-clamp-2 text-xs leading-snug text-slate-600">{p.caption}</p>
                )}
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      {showAdd && (
        <AddPhotosModal
          trips={trips}
          countByTrip={countByTrip}
          defaultTripId={activeFilter !== 'all' ? activeFilter : undefined}
          onClose={() => setShowAdd(false)}
          onDone={(n) => {
            setShowAdd(false);
            onToast(`✅ เพิ่มรูปภาพ ${n} รูปเรียบร้อยแล้ว`);
          }}
        />
      )}

      {viewer !== null && visible[viewer] && (
        <PhotoViewer
          photos={visible}
          index={viewer}
          setIndex={setViewer}
          onClose={() => setViewer(null)}
          onToast={onToast}
        />
      )}
    </div>
  );
}

// ---------- Modal: เพิ่มรูปภาพ ----------

function AddPhotosModal({
  trips,
  countByTrip,
  defaultTripId,
  onClose,
  onDone,
}: {
  trips: TripOption[];
  countByTrip: Record<string, number>;
  defaultTripId?: string;
  onClose: () => void;
  onDone: (n: number) => void;
}) {
  const [tripId, setTripId] = useState(
    defaultTripId ??
      trips.find((t) => (countByTrip[t.id] ?? 0) < MAX_PHOTOS_PER_TRIP)?.id ??
      trips[0]?.id ??
      ''
  );
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [processing, setProcessing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState('');

  const trip = trips.find((t) => t.id === tripId);
  const used = countByTrip[tripId] ?? 0;
  const remaining = Math.max(0, MAX_PHOTOS_PER_TRIP - used);
  const room = Math.max(0, remaining - drafts.length);
  const full = trip !== undefined && remaining === 0;

  const changeTrip = (id: string) => {
    setTripId(id);
    setMsg('');
    // ถ้าโควตาของทริปใหม่น้อยกว่ารูปที่เลือกไว้ ตัดส่วนเกินออก
    const left = Math.max(0, MAX_PHOTOS_PER_TRIP - (countByTrip[id] ?? 0));
    setDrafts((d) => d.slice(0, left));
  };

  const pickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || room === 0) return;
    setMsg('');
    const all = Array.from(files).filter((f) => f.type.startsWith('image/'));
    const picked = all.slice(0, room);
    if (all.length > picked.length) {
      setMsg(`เลือกได้อีกแค่ ${room} รูป ระบบรับเฉพาะ ${picked.length} รูปแรก`);
    }
    setProcessing(true);
    const added: Draft[] = [];
    let failed = 0;
    for (const f of picked) {
      try {
        added.push({ key: Date.now() + Math.random(), data: await compressImage(f), caption: '' });
      } catch {
        failed++;
      }
    }
    if (failed > 0) setMsg(`ไม่สามารถประมวลผลรูปได้ ${failed} รูป (ไฟล์เสียหรือใหญ่เกินไป)`);
    setDrafts((d) => [...d, ...added]);
    setProcessing(false);
  };

  const upload = async () => {
    if (!trip || drafts.length === 0 || drafts.length > remaining) return;
    setUploading(true);
    setMsg('');
    let ok = 0;
    try {
      for (const d of drafts) {
        await addDoc(tripPhotosRef, {
          tripId: trip.id,
          tripName: trip.name,
          imageData: d.data,
          caption: d.caption.trim(),
          createdAt: serverTimestamp(),
        });
        ok++;
      }
      onDone(ok);
    } catch {
      setMsg(
        ok > 0
          ? `อัปโหลดสำเร็จ ${ok} รูป แต่บางรูปล้มเหลว กรุณาลองใหม่`
          : 'อัปโหลดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'
      );
      setDrafts((d) => d.slice(ok));
      setUploading(false);
    }
  };

  const busy = processing || uploading;

  return (
    <div
      className="fixed inset-0 z-[1100] flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={() => !busy && onClose()}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200/80 px-5 py-4">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <ImagePlus size={17} className="text-teal-600" />
            เพิ่มรูปภาพ
          </h3>
          <button
            onClick={onClose}
            disabled={busy}
            className="grid h-8 w-8 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 disabled:opacity-40"
            aria-label="ปิด"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          {trips.length === 0 ? (
            <p className="rounded-xl bg-amber-50 px-3 py-3 text-xs font-medium text-amber-700">
              ยังไม่มีทริปที่บันทึกไว้ กรุณาบันทึกทริปในแท็บ "วางแผนทริป" ก่อน แล้วจึงเพิ่มรูปผูกกับทริปได้
            </p>
          ) : (
            <>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-slate-600">เลือกทริป</span>
                <select
                  value={tripId}
                  onChange={(e) => changeTrip(e.target.value)}
                  disabled={busy}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                >
                  {trips.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({countByTrip[t.id] ?? 0}/{MAX_PHOTOS_PER_TRIP} รูป)
                    </option>
                  ))}
                </select>
              </label>

              <p
                className={`rounded-xl px-3 py-2 text-xs font-semibold ${
                  full ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-700'
                }`}
              >
                {full
                  ? `ทริปนี้มีรูปครบ ${MAX_PHOTOS_PER_TRIP}/${MAX_PHOTOS_PER_TRIP} รูปแล้ว ลบรูปเดิมก่อนจึงจะเพิ่มได้`
                  : `เหลือเพิ่มได้อีก ${remaining - drafts.length}/${MAX_PHOTOS_PER_TRIP} รูป`}
              </p>

              {drafts.length > 0 && (
                <div className="space-y-2.5">
                  {drafts.map((d) => (
                    <div
                      key={d.key}
                      className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-2"
                    >
                      <img src={d.data} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
                      <input
                        value={d.caption}
                        maxLength={80}
                        disabled={uploading}
                        onChange={(e) =>
                          setDrafts((all) =>
                            all.map((x) => (x.key === d.key ? { ...x, caption: e.target.value } : x))
                          )
                        }
                        placeholder="แคปชันสั้นๆ (ไม่บังคับ)"
                        className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                      />
                      <button
                        onClick={() => setDrafts((all) => all.filter((x) => x.key !== d.key))}
                        disabled={uploading}
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-300 transition hover:bg-rose-50 hover:text-rose-500 disabled:opacity-40"
                        aria-label="เอารูปออก"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <label
                className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-sky-200 py-3 text-sm font-semibold text-sky-600 transition hover:border-sky-300 hover:bg-sky-50 ${
                  busy || room === 0 ? 'pointer-events-none opacity-40' : ''
                }`}
              >
                {processing ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />}
                {processing ? 'กำลังย่อรูป...' : room === 0 ? 'ครบโควตาแล้ว' : `เลือกรูปจากเครื่อง (เลือกได้อีก ${room} รูป)`}
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="sr-only"
                  disabled={busy || room === 0}
                  onChange={(e) => {
                    void pickFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
            </>
          )}

          {msg && (
            <p className="flex items-start gap-1.5 text-xs font-medium text-rose-500">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {msg}
            </p>
          )}
        </div>

        <div className="flex gap-3 border-t border-slate-200/80 px-5 py-4">
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
          >
            ยกเลิก
          </button>
          <button
            onClick={() => void upload()}
            disabled={busy || drafts.length === 0 || !trip}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-teal-600 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-teal-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {uploading && <Loader2 size={15} className="animate-spin" />}
            {uploading ? 'กำลังอัปโหลด...' : `อัปโหลด${drafts.length > 0 ? ` (${drafts.length})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Lightbox ----------

function PhotoViewer({
  photos,
  index,
  setIndex,
  onClose,
  onToast,
}: {
  photos: TripPhoto[];
  index: number;
  setIndex: (i: number | null) => void;
  onClose: () => void;
  onToast: (msg: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const photo = photos[index];

  useEffect(() => setConfirming(false), [photo?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') setIndex(Math.max(0, index - 1));
      else if (e.key === 'ArrowRight') setIndex(Math.min(photos.length - 1, index + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, photos.length, onClose, setIndex]);

  if (!photo) return null;

  const remove = async () => {
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'trip_photos', photo.id));
      if (photos.length <= 1) onClose();
      else setIndex(Math.min(index, photos.length - 2));
      onToast('🗑️ ลบรูปภาพเรียบร้อยแล้ว');
    } catch {
      onToast('⚠️ ลบรูปไม่สำเร็จ ลองอีกครั้ง');
    } finally {
      setDeleting(false);
      setConfirming(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1200] flex flex-col bg-black/90" onClick={onClose}>
      <div
        className="flex items-center justify-between gap-3 px-4 py-3 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="min-w-0 truncate text-sm font-semibold">
          {photo.tripName} · {index + 1}/{photos.length}
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          <a
            href={photo.imageData}
            download={`${(photo.tripName || 'trip').replace(/[\\/:*?"<>|]/g, '_')}-${index + 1}.jpg`}
            className="grid h-9 w-9 place-items-center rounded-full bg-white/15 transition hover:bg-white/25"
            aria-label="ดาวน์โหลดรูป"
            title="ดาวน์โหลด"
          >
            <Download size={16} />
          </a>
          <button
            onClick={() => setConfirming(true)}
            className="grid h-9 w-9 place-items-center rounded-full bg-white/15 transition hover:bg-rose-500/80"
            aria-label="ลบรูป"
            title="ลบรูป"
          >
            <Trash2 size={16} />
          </button>
          <button
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-full bg-white/15 transition hover:bg-white/25"
            aria-label="ปิด"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 sm:px-14">
        {index > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIndex(index - 1);
            }}
            className="absolute left-2 z-10 grid h-10 w-10 place-items-center rounded-full bg-white/20 text-white backdrop-blur transition hover:bg-white/35"
            aria-label="รูปก่อนหน้า"
          >
            <ChevronLeft size={22} />
          </button>
        )}
        <img
          src={photo.imageData}
          alt={photo.caption || photo.tripName}
          onClick={(e) => e.stopPropagation()}
          className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
        />
        {index < photos.length - 1 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIndex(index + 1);
            }}
            className="absolute right-2 z-10 grid h-10 w-10 place-items-center rounded-full bg-white/20 text-white backdrop-blur transition hover:bg-white/35"
            aria-label="รูปถัดไป"
          >
            <ChevronRight size={22} />
          </button>
        )}
      </div>

      <div className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
        {photo.caption && <p className="text-sm text-white/90">{photo.caption}</p>}
      </div>

      {confirming && (
        <div
          className="absolute inset-0 z-20 grid place-items-center bg-black/60 p-4"
          onClick={(e) => {
            e.stopPropagation();
            if (!deleting) setConfirming(false);
          }}
        >
          <div
            className="w-full max-w-xs rounded-2xl bg-white p-5 text-center shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <Trash2 size={28} className="mx-auto mb-2 text-rose-500" />
            <p className="text-sm font-bold text-slate-900">ลบรูปภาพนี้?</p>
            <p className="mt-1 text-xs text-slate-500">ลบแล้วไม่สามารถกู้คืนได้</p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setConfirming(false)}
                disabled={deleting}
                className="flex-1 rounded-xl border border-slate-200 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                ยกเลิก
              </button>
              <button
                onClick={() => void remove()}
                disabled={deleting}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-rose-500 py-2 text-xs font-bold text-white hover:bg-rose-600 disabled:opacity-60"
              >
                {deleting && <Loader2 size={13} className="animate-spin" />}
                ลบรูป
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
