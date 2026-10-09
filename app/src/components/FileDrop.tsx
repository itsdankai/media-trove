import { FileUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  FileUpload,
  FileUploadDropzone,
  FileUploadItem,
  FileUploadItemDelete,
  FileUploadItemMetadata,
  FileUploadItemPreview,
  FileUploadList,
  FileUploadTrigger,
} from "@/components/ui/file-upload";

/** One-file drop zone (Dice UI): drag a file in or click to pick one. The parent sends it on submit. */
export function FileDrop({
  label,
  accept,
  file,
  onFile,
  hint,
}: {
  label: string;
  accept?: string;
  file: File | null;
  onFile: (file: File | null) => void;
  hint?: string;
}) {
  return (
    <FileUpload
      label={label}
      accept={accept}
      maxFiles={1}
      value={file ? [file] : []}
      onValueChange={(files) => onFile(files[0] ?? null)}
    >
      {!file && (
        <FileUploadDropzone className="gap-1 p-5 text-center">
          <FileUp className="size-6 text-primary" />
          <p className="text-sm font-medium">Drop the file here</p>
          <p className="text-xs text-muted-foreground">
            {hint ?? (accept ? `${accept.replaceAll(",", ", ")} · ` : "")}or{" "}
            <FileUploadTrigger asChild>
              <Button variant="link" size="sm" className="h-auto p-0 text-xs">
                choose one
              </Button>
            </FileUploadTrigger>
          </p>
        </FileUploadDropzone>
      )}
      <FileUploadList>
        {file && (
          <FileUploadItem value={file}>
            <FileUploadItemPreview />
            <FileUploadItemMetadata />
            <FileUploadItemDelete asChild>
              <Button variant="ghost" size="icon" aria-label={`Remove ${file.name}`}>
                <X />
              </Button>
            </FileUploadItemDelete>
          </FileUploadItem>
        )}
      </FileUploadList>
    </FileUpload>
  );
}
