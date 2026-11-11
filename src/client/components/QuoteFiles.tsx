import { useRef, useState } from 'react';
import { MAX_FILE_BYTES, QUOTE_FILE_ACCEPT, formatFileSize, isPdf } from '../../shared/files';
import { api, fileUrl } from '../api';
import { useData } from '../data';
import { Icon, IconButton } from './ui';

/** Throws a readable error for files the server would refuse anyway. */
export function checkFileSize(file: File) {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`"${file.name}" גדול מדי. הגודל המרבי הוא ${formatFileSize(MAX_FILE_BYTES)}.`);
  }
}

/** The PDF and image files of one quote: open, add and delete. */
export function QuoteFiles({ quoteId }: { quoteId: string }) {
  const { data, run } = useData();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const files = data.quoteFiles.filter((f) => f.quoteId === quoteId);

  const upload = async (list: FileList | null) => {
    const picked = Array.from(list ?? []);
    if (input.current) input.current.value = '';
    if (!picked.length) return;
    setUploading(picked.length);
    await run(async () => {
      picked.forEach(checkFileSize);
      for (const file of picked) await api.uploadQuoteFile(quoteId, file);
    });
    setUploading(0);
  };

  return (
    <div className="quote-files">
      {files.length > 0 && (
        <ul className="files">
          {files.map((f) => (
            <li key={f.id} className="file">
              <a href={fileUrl(f.id)} target="_blank" rel="noopener" className="file-link">
                <Icon name={isPdf(f.contentType) ? 'pdf' : 'image'} />
                <span className="file-name" dir="auto">
                  {f.fileName}
                </span>
                <span className="file-size" dir="ltr">
                  {formatFileSize(f.size)}
                </span>
              </a>
              <IconButton
                icon="trash"
                label={`מחיקת הקובץ ${f.fileName}`}
                danger
                onClick={() => {
                  if (confirm(`למחוק את הקובץ "${f.fileName}"?`)) void run(() => api.deleteFile(f.id));
                }}
              />
            </li>
          ))}
        </ul>
      )}
      <label className={`btn small file-pick ${uploading ? 'is-busy' : ''}`}>
        <Icon name="attach" />
        {uploading ? (uploading > 1 ? `מעלה ${uploading} קבצים…` : 'מעלה…') : 'צירוף PDF או תמונה'}
        <input
          ref={input}
          type="file"
          accept={QUOTE_FILE_ACCEPT}
          multiple
          disabled={uploading > 0}
          className="sr-only"
          onChange={(e) => void upload(e.target.files)}
        />
      </label>
    </div>
  );
}
