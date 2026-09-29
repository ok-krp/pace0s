import { useEffect, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats, type CameraDevice } from "html5-qrcode";
import { X, Image as ImageIcon, RefreshCw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";

const FORMATS = [
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.CODE_93,
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.DATA_MATRIX,
  Html5QrcodeSupportedFormats.AZTEC,
  Html5QrcodeSupportedFormats.PDF_417,
];

async function rotateImageFile(file: File, degrees: 90 | 180 | 270): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Image QR illisible."));
      element.src = url;
    });
    const quarterTurn = degrees === 90 || degrees === 270;
    const canvas = document.createElement("canvas");
    canvas.width = quarterTurn ? image.naturalHeight : image.naturalWidth;
    canvas.height = quarterTurn ? image.naturalWidth : image.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas indisponible.");
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((degrees * Math.PI) / 180);
    ctx.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Conversion de l'image impossible.")), file.type || "image/jpeg", 0.95);
    });
    return new File([blob], file.name, { type: file.type || "image/jpeg" });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function BarcodeScanner({
  onDetected,
  onClose,
}: {
  onDetected: (code: string) => void;
  onClose: () => void;
}) {
  const elId = useRef(`qr-${Math.random().toString(36).slice(2)}`).current;
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [activeCamId, setActiveCamId] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);

  const config = {
    fps: 10,
    qrbox: (vw: number, vh: number) => {
      const side = Math.min(vw, vh) - 80;
      const s = Math.max(180, Math.min(side, 320));
      return { width: s, height: s };
    },
    aspectRatio: 1.0,
  };

  const stopScanner = async () => {
    const s = scannerRef.current;
    if (s && s.isScanning) {
      try { await s.stop(); } catch {}
      try { s.clear(); } catch {}
    }
  };

  const startWith = async (camId: string) => {
    setErr(null);
    setStarting(true);
    await stopScanner();
    const scanner = new Html5Qrcode(elId, { verbose: false, formatsToSupport: FORMATS });
    scannerRef.current = scanner;
    try {
      await scanner.start(
        camId,
        config,
        (decoded) => onDetected(decoded),
        () => {}
      );
      setActiveCamId(camId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Caméra inaccessible");
    } finally {
      setStarting(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cams = await Html5Qrcode.getCameras();
        if (cancelled) return;
        if (!cams.length) {
          setErr("Aucune caméra détectée. Utilisez 'Importer une image'.");
          setStarting(false);
          return;
        }
        setCameras(cams);
        // prefer back camera
        const back = cams.find((c) => /back|rear|environment|arrière|arriere/i.test(c.label)) ?? cams[cams.length - 1];
        await startWith(back.id);
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : "Accès caméra refusé");
          setStarting(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchCamera = async () => {
    if (cameras.length < 2) return;
    const idx = cameras.findIndex((c) => c.id === activeCamId);
    const next = cameras[(idx + 1) % cameras.length];
    await startWith(next.id);
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await stopScanner();

    const candidates: File[] = [file];
    try {
      for (const degrees of [180, 90, 270] as const) {
        let scanner: Html5Qrcode | null = null;
        const candidate = candidates[candidates.length - 1];
        try {
          scanner = new Html5Qrcode(elId, { verbose: false, formatsToSupport: FORMATS });
          scannerRef.current = scanner;
          const result = await scanner.scanFile(candidate, false);
          onDetected(result);
          return;
        } catch {
          if (scanner) {
            try { scanner.clear(); } catch {}
          }
          if (degrees === 180 || degrees === 90) {
            candidates.push(await rotateImageFile(file, degrees));
          }
        }
      }
      const last = await rotateImageFile(file, 270);
      const scanner = new Html5Qrcode(elId, { verbose: false, formatsToSupport: FORMATS });
      scannerRef.current = scanner;
      try {
        const result = await scanner.scanFile(last, false);
        onDetected(result);
        return;
      } finally {
        try { scanner.clear(); } catch {}
      }
    } catch {
      setErr("Aucun code détecté. Pace a essayé l'image originale et les rotations 90°, 180° et 270°. Essayez une photo plus nette.");
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/95 flex flex-col">
      <div className="flex items-center justify-between p-4 text-white">
        <div className="text-sm font-medium">Pointez vers un code-barres ou QR</div>
        <button onClick={onClose} className="p-2 rounded-full bg-white/10" aria-label="Fermer"><X className="size-5" /></button>
      </div>

      <div className="flex-1 relative overflow-hidden">
        <div id={elId} className="absolute inset-0" />
        {starting && !err && (
          <div className="absolute inset-0 grid place-items-center text-white/70 text-sm">Initialisation caméra…</div>
        )}
      </div>

      {err && (
        <div className="px-6 py-4 text-center text-white">
          <p className="text-sm text-red-300 mb-2">{err}</p>
          <p className="text-xs text-white/60">Sur desktop, autorisez la webcam ou importez une image du code.</p>
        </div>
      )}

      <div className="p-4 flex flex-wrap gap-2 justify-center bg-black/60 border-t border-white/10">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          className="rounded-xl"
        >
          <Upload className="size-4 mr-1.5" /> Importer une image
        </Button>
        {cameras.length > 1 && (
          <Button variant="secondary" size="sm" onClick={switchCamera} className="rounded-xl">
            <RefreshCw className="size-4 mr-1.5" /> Changer de caméra
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onClose} className="rounded-xl text-white hover:text-white hover:bg-white/10">
          Fermer
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFile}
          className="hidden"
        />
        <div className="basis-full text-center text-[11px] text-white/50 mt-1 flex items-center justify-center gap-1">
          <ImageIcon className="size-3" /> QR · EAN · UPC · Code128 · DataMatrix · PDF417
        </div>
      </div>
    </div>
  );
}
