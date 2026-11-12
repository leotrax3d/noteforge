//! Windows-Implementierung: InkAnalyzer (Handschrift) und Windows.Media.Ocr (Bilder).
//! Beides läuft offline über die WinRT-APIs des Systems.

use super::{Box2, InkResult, InkStrokeIn, OcrResult, RecErr, RecLine, RecWord};
use windows::Foundation::{Point, Rect};
use windows::Globalization::Language;
use windows::Graphics::Imaging::{
    BitmapAlphaMode, BitmapDecoder, BitmapInterpolationMode, BitmapPixelFormat, BitmapTransform,
    ColorManagementMode, ExifOrientationMode,
};
use windows::Media::Ocr::OcrEngine;
use windows::Security::Cryptography::CryptographicBuffer;
use windows::Storage::Streams::InMemoryRandomAccessStream;
use windows::UI::Input::Inking::Analysis::{
    InkAnalysisInkWord, InkAnalysisLine, InkAnalysisNodeKind, InkAnalysisStatus, InkAnalyzer,
};
use windows::UI::Input::Inking::{InkPoint, InkStroke, InkStrokeBuilder};
use windows::core::{HSTRING, Interface};
use windows_collections::IIterable;

fn w(e: windows::core::Error) -> RecErr {
    RecErr::Failed(e.message().to_string())
}

/// WinRT im aktuellen (Blocking-)Thread initialisieren; mehrfacher Aufruf ist harmlos.
fn init() {
    unsafe {
        let _ = windows::Win32::System::WinRT::RoInitialize(windows::Win32::System::WinRT::RO_INIT_MULTITHREADED);
    }
}

fn bx(r: Rect) -> Box2 {
    Box2 { x: r.X as f64, y: r.Y as f64, w: r.Width as f64, h: r.Height as f64 }
}

fn build_strokes(strokes: &[InkStrokeIn]) -> windows::core::Result<Vec<Option<InkStroke>>> {
    let builder = InkStrokeBuilder::new()?;
    let identity = windows_numerics::Matrix3x2::identity();
    let mut out = Vec::with_capacity(strokes.len());
    for s in strokes {
        let pts: Vec<Option<InkPoint>> = s
            .points
            .chunks_exact(super::PSTRIDE)
            .map(|p| {
                let pressure = p[2].clamp(0.05, 1.0);
                InkPoint::CreateInkPoint(Point { X: p[0], Y: p[1] }, pressure).ok()
            })
            .collect();
        if pts.len() < 2 {
            continue;
        }
        out.push(Some(builder.CreateStrokeFromInkPoints(&IIterable::<InkPoint>::from(pts), identity)?));
    }
    Ok(out)
}

pub fn recognize_ink(strokes: &[InkStrokeIn]) -> Result<InkResult, RecErr> {
    init();
    let ink = build_strokes(strokes).map_err(w)?;
    if ink.is_empty() {
        return Ok(InkResult::default());
    }
    let analyzer = InkAnalyzer::new().map_err(w)?;
    analyzer.AddDataForStrokes(&IIterable::<InkStroke>::from(ink)).map_err(w)?;
    let res = analyzer.AnalyzeAsync().map_err(w)?.join().map_err(w)?;
    if res.Status().map_err(w)? != InkAnalysisStatus::Updated {
        return Err(RecErr::Failed("Analyse unvollständig".into()));
    }
    let root = analyzer.AnalysisRoot().map_err(w)?;
    let mut out = InkResult::default();
    for n in root.FindNodes(InkAnalysisNodeKind::Line).map_err(w)? {
        let l: InkAnalysisLine = n.cast().map_err(w)?;
        out.lines.push(RecLine {
            text: l.RecognizedText().map_err(w)?.to_string(),
            bbox: bx(l.BoundingRect().map_err(w)?),
        });
    }
    for n in root.FindNodes(InkAnalysisNodeKind::InkWord).map_err(w)? {
        let iw: InkAnalysisInkWord = n.cast().map_err(w)?;
        out.words.push(RecWord {
            text: iw.RecognizedText().map_err(w)?.to_string(),
            bbox: bx(iw.BoundingRect().map_err(w)?),
        });
    }
    Ok(out.finish())
}

fn engine() -> Result<(OcrEngine, String), RecErr> {
    let de = Language::CreateLanguage(&HSTRING::from("de-DE")).map_err(w)?;
    if OcrEngine::IsLanguageSupported(&de).unwrap_or(false)
        && let Ok(e) = OcrEngine::TryCreateFromLanguage(&de)
    {
        return Ok((e, "de-DE".into()));
    }
    let e = OcrEngine::TryCreateFromUserProfileLanguages()
        .map_err(|_| RecErr::Unavailable("Keine OCR-Sprache installiert (Einstellungen → Sprache → Deutsch)".into()))?;
    let tag = e.RecognizerLanguage().and_then(|l| l.LanguageTag()).map(|t| t.to_string()).unwrap_or_default();
    Ok((e, tag))
}

pub fn ocr_language() -> Option<String> {
    init();
    engine().ok().map(|(_, l)| l)
}

pub fn ink_available() -> bool {
    init();
    InkAnalyzer::new().is_ok()
}

pub fn ocr(bytes: &[u8]) -> Result<OcrResult, RecErr> {
    init();
    let (engine, _) = engine()?;
    let stream = InMemoryRandomAccessStream::new().map_err(w)?;
    let buf = CryptographicBuffer::CreateFromByteArray(bytes).map_err(w)?;
    stream.WriteAsync(&buf).map_err(w)?.join().map_err(w)?;
    stream.Seek(0).map_err(w)?;
    let dec = BitmapDecoder::CreateAsync(&stream).map_err(w)?.join().map_err(w)?;
    let (pw, ph) = (dec.OrientedPixelWidth().map_err(w)?, dec.OrientedPixelHeight().map_err(w)?);
    let max = OcrEngine::MaxImageDimension().unwrap_or(10_000).max(1);
    let t = BitmapTransform::new().map_err(w)?;
    let k = (max as f64 / pw.max(ph).max(1) as f64).min(1.0);
    // Kleine Bilder hochskalieren: Windows-OCR braucht etwa 20 px hohe Schrift
    let k = if pw.max(ph) < 1200 { (1200.0 / pw.max(ph).max(1) as f64).min(max as f64 / pw.max(ph).max(1) as f64) } else { k };
    let (sw, sh) = (((pw as f64) * k).round().max(1.0) as u32, ((ph as f64) * k).round().max(1.0) as u32);
    t.SetScaledWidth(sw).map_err(w)?;
    t.SetScaledHeight(sh).map_err(w)?;
    t.SetInterpolationMode(BitmapInterpolationMode::Fant).map_err(w)?;
    let bmp = dec
        .GetSoftwareBitmapTransformedAsync(
            BitmapPixelFormat::Bgra8,
            BitmapAlphaMode::Premultiplied,
            &t,
            ExifOrientationMode::RespectExifOrientation,
            ColorManagementMode::DoNotColorManage,
        )
        .map_err(w)?
        .join()
        .map_err(w)?;
    let r = engine.RecognizeAsync(&bmp).map_err(w)?.join().map_err(w)?;
    // Koordinaten zurück auf Bildpixel des Originals
    let inv = 1.0 / k;
    let mut out = OcrResult { width: pw, height: ph, ..Default::default() };
    for line in r.Lines().map_err(w)? {
        let mut words = vec![];
        for wd in line.Words().map_err(w)? {
            let b = bx(wd.BoundingRect().map_err(w)?);
            words.push(RecWord {
                text: wd.Text().map_err(w)?.to_string(),
                bbox: Box2 { x: b.x * inv, y: b.y * inv, w: b.w * inv, h: b.h * inv },
            });
        }
        let bbox = Box2::union(words.iter().map(|w| w.bbox));
        out.lines.push(RecLine { text: line.Text().map_err(w)?.to_string(), bbox });
        out.words.extend(words);
    }
    out.text = out.lines.iter().map(|l| l.text.as_str()).collect::<Vec<_>>().join("\n");
    Ok(out)
}
