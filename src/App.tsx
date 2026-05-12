import React, { useState, useEffect, useRef } from 'react';
import { PDFDocument, degrees } from 'pdf-lib';
import { 
  FileUp, Settings2, Download, RotateCw, SplitSquareVertical, 
  Combine, Palette, Trash2, Eye, FileText, ChevronRight, Wand2
} from 'lucide-react';
import { cn } from './lib/utils';
import { rasterizePdfWithFilters } from './lib/rasterize';

type Tool = 'merge' | 'split' | 'rotate' | 'effects';

interface SplitRange {
  start: number;
  end: number;
}

export default function App() {
  const [files, setFiles] = useState<File[]>([]);
  const [activeTool, setActiveTool] = useState<Tool>('merge');
  
  // Processing States
  const [isProcessing, setIsProcessing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [downloadBlob, setDownloadBlob] = useState<Blob | null>(null);
  
  // Tool Configs
  const [rotateAngle, setRotateAngle] = useState(0);
  const [splitRange, setSplitRange] = useState<SplitRange>({ start: 1, end: 1 });
  const [maxPages, setMaxPages] = useState(1);
  const [cssFilter, setCssFilter] = useState<string>('');
  const [activeFilters, setActiveFilters] = useState({ grayscale: false, invert: false, sepia: false, contrast: false });
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Read max pages when file changes for split tool
  useEffect(() => {
    if (activeTool === 'split' && files.length === 1) {
      loadMaxPages(files[0]);
    }
  }, [files, activeTool]);

  const loadMaxPages = async (file: File) => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdfDoc = await PDFDocument.load(arrayBuffer);
      const pageCount = pdfDoc.getPageCount();
      setMaxPages(pageCount);
      setSplitRange({ start: 1, end: pageCount });
    } catch (error) {
      console.error("Failed to load PDF pages", error);
    }
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFiles = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf');
    if (activeTool === 'merge') {
      setFiles(prev => [...prev, ...droppedFiles]);
    } else {
      setFiles(droppedFiles.slice(0, 1));
      setRotateAngle(0);
      setCssFilter('');
    }
    setDownloadBlob(null);
    setPreviewUrl(null);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files).filter(f => f.type === 'application/pdf');
      if (activeTool === 'merge') {
        setFiles(prev => [...prev, ...selectedFiles]);
      } else {
        setFiles(selectedFiles.slice(0, 1));
        setRotateAngle(0);
        setCssFilter('');
      }
      setDownloadBlob(null);
      setPreviewUrl(null);
    }
  };

  const removeFile = (index: number) => {
    setFiles(files.filter((_, i) => i !== index));
    if (files.length <= 1) {
        setDownloadBlob(null);
        setPreviewUrl(null);
    }
  };

  // Switch tool reset
  useEffect(() => {
    if (activeTool !== 'merge' && files.length > 1) {
       setFiles(files.slice(0, 1));
    }
    setDownloadBlob(null);
    setPreviewUrl(null);
    setRotateAngle(0);
    setCssFilter('');
    setActiveFilters({ grayscale: false, invert: false, sepia: false, contrast: false });
  }, [activeTool]);


  // Re-run processing whenever config changes (real-time preview)
  useEffect(() => {
    if (files.length === 0) return;
    
    // For CSS filters, we don't need to rebuild the PDF for preview, just update the iframe visually
    // but we still want to load the original into the preview.
    if (activeTool === 'effects') {
        processFilterPreview();
    } else {
        processPdf();
    }
  }, [files, rotateAngle, splitRange.start, splitRange.end, activeTool, activeFilters]);

  const processFilterPreview = async () => {
    if (files.length === 0) return;
    try {
        setIsProcessing(true);
        if (activeTool === 'effects') {
            const f = [];
            if (activeFilters.grayscale) f.push('grayscale(100%)');
            if (activeFilters.invert) f.push('invert(100%) hue-rotate(180deg)');
            if (activeFilters.sepia) f.push('sepia(100%)');
            if (activeFilters.contrast) f.push('contrast(150%)');
            setCssFilter(f.join(' '));
        }
        else setCssFilter('');

        const arrayBuffer = await files[0].arrayBuffer();
        const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
        
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        const newUrl = URL.createObjectURL(blob);
        setPreviewUrl(newUrl);
        
        // For download, we just provide the original for now or explicitly state it's visual.
        // Rasterizing is too heavy for client-side without massive dependencies.
        setDownloadBlob(blob);
    } catch (e) {
        console.error(e);
    } finally {
        setIsProcessing(false);
    }
  };

  const processPdf = async () => {
    if (files.length === 0) return;
    if (activeTool === 'merge' && files.length < 2) {
        // Just show the first one if we can't merge yet
        const arrayBuffer = await files[0].arrayBuffer();
        const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(URL.createObjectURL(blob));
        return;
    }

    setIsProcessing(true);
    setCssFilter(''); // Reset any CSS filters applied from other tools
    try {
      let finalDoc = await PDFDocument.create();

      if (activeTool === 'merge') {
        for (const file of files) {
          const arrayBuffer = await file.arrayBuffer();
          const pDoc = await PDFDocument.load(arrayBuffer);
          const copiedPages = await finalDoc.copyPages(pDoc, pDoc.getPageIndices());
          copiedPages.forEach(p => finalDoc.addPage(p));
        }
      } 
      else if (activeTool === 'rotate' && files[0]) {
        const arrayBuffer = await files[0].arrayBuffer();
        finalDoc = await PDFDocument.load(arrayBuffer);
        const pages = finalDoc.getPages();
        pages.forEach(page => {
           // We just set the rotation based on state
           // If we wanted cumulative we'd read current rotation first, but state is absolute here
           page.setRotation(degrees(rotateAngle));
        });
      }
      else if (activeTool === 'split' && files[0]) {
        const arrayBuffer = await files[0].arrayBuffer();
        const pDoc = await PDFDocument.load(arrayBuffer);
        
        const total = pDoc.getPageCount();
        const s = Math.max(0, splitRange.start - 1);
        const e = Math.min(total - 1, splitRange.end - 1);
        
        const indices = [];
        for (let i = s; i <= e; i++) indices.push(i);
        
        if (indices.length > 0) {
           const copiedPages = await finalDoc.copyPages(pDoc, indices);
           copiedPages.forEach(p => finalDoc.addPage(p));
        } else {
             // Fallback empty doc
           finalDoc.addPage([500, 500]);
        }
      }

      const pdfBytes = await finalDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      setDownloadBlob(blob);
      
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const newUrl = URL.createObjectURL(blob);
      setPreviewUrl(newUrl);

    } catch (error) {
      console.error("Error processing PDF:", error);
    } finally {
      setIsProcessing(false);
    }
  };


  const downloadPdf = async () => {
    if (!downloadBlob) return;

    let finalBlobToDownload = downloadBlob;
    const hasActiveFilters = activeTool === 'effects' && Object.values(activeFilters).some(v => v);

    if (hasActiveFilters) {
       setIsDownloading(true);
       setDownloadProgress(0);
       try {
          const arrayBuffer = await finalBlobToDownload.arrayBuffer();
          const rasterizedBytes = await rasterizePdfWithFilters(arrayBuffer, activeFilters, (progress) => {
              setDownloadProgress(progress);
          });
          finalBlobToDownload = new Blob([rasterizedBytes], { type: 'application/pdf' });
       } catch (err) {
          console.error("Rasterization failed:", err);
          alert("Failed to apply filters dynamically. Downloading the original file.");
       } finally {
          setIsDownloading(false);
       }
    }

    const url = URL.createObjectURL(finalBlobToDownload);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Studio_${activeTool}_${Date.now()}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const tools = [
    { id: 'merge', icon: Combine, label: 'Merge' },
    { id: 'split', icon: SplitSquareVertical, label: 'Split' },
    { id: 'rotate', icon: RotateCw, label: 'Rotate' },
    { id: 'effects', icon: Palette, label: 'Effects & Filters' },
  ] as const;

  return (
    <div className="flex h-screen bg-neutral-50 font-sans text-neutral-900 overflow-hidden">
      
      {/* Sidebar */}
      <aside className="w-72 bg-white border-r border-neutral-200 flex flex-col shadow-sm z-10">
        <div className="p-6 border-b border-neutral-100">
            <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2 text-indigo-600">
                <FileText className="w-6 h-6" />
                PDF Studio
            </h1>
            <p className="text-xs text-neutral-500 mt-1">Real-time PDF manipulation</p>
        </div>
        
        <div className="p-4 flex-1 overflow-y-auto">
            <div className="space-y-1 mb-8">
                <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3 px-2">Tools</h3>
                {tools.map(tool => (
                    <button
                        key={tool.id}
                        onClick={() => setActiveTool(tool.id)}
                        className={cn(
                            "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                            activeTool === tool.id 
                                ? "bg-indigo-50 text-indigo-700" 
                                : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
                        )}
                    >
                        <tool.icon className={cn("w-5 h-5", activeTool === tool.id ? "text-indigo-600" : "text-neutral-400")} />
                        {tool.label}
                    </button>
                ))}
            </div>

            {/* Tool Specific Configurations */}
            {files.length > 0 && (
                <div className="bg-neutral-50 rounded-xl p-4 border border-neutral-200 shadow-inner">
                    <h3 className="text-sm font-semibold flex items-center gap-2 mb-4">
                        <Settings2 className="w-4 h-4 text-neutral-500" />
                        Options
                    </h3>
                    
                    {activeTool === 'rotate' && (
                        <div className="space-y-3">
                            <label className="text-xs text-neutral-500 font-medium tracking-wide">Rotation</label>
                            <div className="flex gap-2">
                                {[0, 90, 180, 270].map(deg => (
                                    <button 
                                        key={deg}
                                        onClick={() => setRotateAngle(deg)}
                                        className={cn(
                                            "flex-1 py-1.5 text-xs font-medium rounded border transition-colors",
                                            rotateAngle === deg 
                                                ? "bg-indigo-600 text-white border-indigo-600" 
                                                : "bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50"
                                        )}
                                    >
                                        {deg}°
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {activeTool === 'split' && files.length === 1 && (
                        <div className="space-y-3">
                            <label className="text-xs text-neutral-500 font-medium tracking-wide">Extract Range (Max: {maxPages})</label>
                            <div className="flex items-center gap-2">
                                <input 
                                    type="number" 
                                    min={1} max={maxPages}
                                    value={splitRange.start}
                                    onChange={e => setSplitRange(s => ({...s, start: Math.max(1, parseInt(e.target.value) || 1)}))}
                                    className="w-full bg-white border border-neutral-300 rounded px-2 py-1.5 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                                />
                                <span className="text-neutral-400 text-sm">to</span>
                                <input 
                                    type="number" 
                                    min={1} max={maxPages}
                                    value={splitRange.end}
                                    onChange={e => setSplitRange(s => ({...s, end: Math.min(maxPages, parseInt(e.target.value) || maxPages)}))}
                                    className="w-full bg-white border border-neutral-300 rounded px-2 py-1.5 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                                />
                            </div>
                        </div>
                    )}

                    {activeTool === 'effects' && (
                        <div className="space-y-3">
                            <label className="text-xs text-neutral-500 font-medium tracking-wide">Toggle Effects</label>
                            <div className="flex flex-col gap-2">
                                {(Object.keys(activeFilters) as Array<keyof typeof activeFilters>).map(key => (
                                    <button
                                        key={key}
                                        onClick={() => setActiveFilters(prev => ({...prev, [key]: !prev[key]}))}
                                        className={cn(
                                            "flex items-center justify-between px-3 py-2 text-sm font-medium rounded-lg border transition-colors",
                                            activeFilters[key]
                                                ? "bg-indigo-50 border-indigo-200 text-indigo-700"
                                                : "bg-white border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                                        )}
                                    >
                                        <span className="capitalize">{key}</span>
                                        <div className={cn(
                                            "w-8 h-4 rounded-full transition-colors relative",
                                            activeFilters[key] ? "bg-indigo-600" : "bg-neutral-300"
                                        )}>
                                            <div className={cn(
                                                "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all shadow-sm",
                                                activeFilters[key] ? "left-4" : "left-0.5"
                                            )} />
                                        </div>
                                    </button>
                                ))}
                            </div>
                            <p className="text-xs text-neutral-500 leading-relaxed mt-4">
                                <span className="font-semibold text-amber-600">Note:</span> Applying effects will convert your PDF pages to images upon download to preserve the colors. Text will not be selectable.
                            </p>
                        </div>
                    )}

                    {activeTool === 'merge' && (
                        <p className="text-xs text-neutral-500 leading-relaxed">
                            Drag and drop additional PDFs into the main area to append them.
                        </p>
                    )}
                </div>
            )}
        </div>

        <div className="p-4 border-t border-neutral-200 bg-neutral-50">
           <button
             onClick={downloadPdf}
             disabled={!downloadBlob || files.length === 0 || isProcessing}
             className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-neutral-300 disabled:text-neutral-500 text-white py-2.5 rounded-lg font-medium transition-colors shadow-sm"
           >
             <Download className="w-4 h-4" />
             Download PDF
           </button>
        </div>
      </aside>

      {/* Main Workspace */}
      <main className="flex-1 flex flex-col bg-neutral-100 relative">
        {(isProcessing || isDownloading) && (
            <div className="absolute inset-0 bg-white/70 backdrop-blur-sm z-20 flex flex-col items-center justify-center">
                <div className="animate-spin text-indigo-600 mb-4">
                    <RotateCw className="w-8 h-8" />
                </div>
                {isDownloading && (
                    <div className="text-center font-medium text-indigo-800">
                        <p>Processing High-Quality PDF...</p>
                        <p className="text-sm mt-1">{downloadProgress}%</p>
                        <div className="w-48 h-2 bg-indigo-100 rounded-full mt-3 overflow-hidden">
                            <div className="h-full bg-indigo-600 transition-all duration-300" style={{ width: `${downloadProgress}%` }} />
                        </div>
                    </div>
                )}
            </div>
        )}

        {/* Upload Area / File List */}
        <div 
            className="p-6 shrink-0"
            onDragOver={e => e.preventDefault()}
            onDrop={handleFileDrop}
        >
            {files.length === 0 ? (
                <div className="bg-white border-2 border-dashed border-neutral-300 rounded-2xl h-48 flex flex-col items-center justify-center text-center p-6 transition-colors hover:border-indigo-400 hover:bg-indigo-50/50">
                    <input 
                        type="file" 
                        id="pdf-upload" 
                        accept="application/pdf"
                        multiple={activeTool === 'merge'}
                        className="hidden" 
                        onChange={handleFileInput}
                    />
                    <label htmlFor="pdf-upload" className="cursor-pointer flex flex-col items-center">
                        <div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mb-4">
                            <FileUp className="w-6 h-6" />
                        </div>
                        <h4 className="text-base font-semibold text-neutral-800 mb-1">Upload PDF Files</h4>
                        <p className="text-sm text-neutral-500">Drag and drop or click to browse</p>
                        {activeTool !== 'merge' && <p className="text-xs text-neutral-400 mt-2">Only one file allowed for {tools.find(t=>t.id===activeTool)?.label}</p>}
                    </label>
                </div>
            ) : (
                <div className="flex gap-4 overflow-x-auto pb-4 snap-x">
                    {files.map((file, idx) => (
                        <div key={idx} className="shrink-0 w-64 bg-white border border-neutral-200 rounded-xl p-3 flex items-center gap-3 shadow-sm snap-start relative group">
                            <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded flex items-center justify-center shrink-0">
                                <FileText className="w-5 h-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-neutral-800 truncate">{file.name}</p>
                                <p className="text-xs text-neutral-400">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                            </div>
                            <button 
                                onClick={() => removeFile(idx)}
                                className="w-8 h-8 flex items-center justify-center text-neutral-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    ))}
                    {activeTool === 'merge' && (
                        <div className="shrink-0 w-32 border-2 border-dashed border-neutral-300 rounded-xl flex items-center justify-center snap-start hover:border-indigo-400 hover:bg-white transition-colors">
                           <input 
                                type="file" 
                                id="pdf-upload-more" 
                                accept="application/pdf"
                                multiple
                                className="hidden" 
                                onChange={handleFileInput}
                            />
                            <label htmlFor="pdf-upload-more" className="cursor-pointer flex flex-col items-center w-full h-full justify-center text-neutral-500 hover:text-indigo-600">
                                <Combine className="w-6 h-6 mb-1" />
                                <span className="text-xs font-medium">Add More</span>
                            </label>
                        </div>
                    )}
                </div>
            )}
        </div>

        {/* Live Preview Area */}
        <div className="flex-1 p-6 pt-0 flex flex-col min-h-0">
            <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 flex-1 flex flex-col overflow-hidden">
                <div className="px-4 py-3 border-b border-neutral-100 flex items-center gap-2 shrink-0">
                    <Eye className="w-4 h-4 text-neutral-500" />
                    <h2 className="text-sm font-semibold text-neutral-700">Real-time Preview</h2>
                </div>
                <div className="flex-1 bg-neutral-100/50 p-4 overflow-hidden flex justify-center object-contain relative">
                    {!previewUrl ? (
                         <div className="absolute inset-0 flex items-center justify-center text-neutral-400 flex-col gap-3">
                             <Eye className="w-12 h-12 opacity-20" />
                             <p className="text-sm">Upload a PDF to see the live preview</p>
                         </div>
                    ) : (
                        <iframe
                            ref={iframeRef}
                            src={`${previewUrl}#toolbar=0`}
                            className="w-full h-full rounded shadow-md border-0 bg-white transition-all transform origin-center"
                            style={{ 
                                filter: cssFilter,
                                // We rely on pdf-lib for actual rotation, but if we wanted fast CSS rotation:
                                // transform: `rotate(${rotateAngle}deg)` 
                            }}
                            title="PDF Preview"
                        />
                    )}
                </div>
            </div>
        </div>
      </main>

    </div>
  );
}

