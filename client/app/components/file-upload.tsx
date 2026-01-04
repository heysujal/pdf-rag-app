'use client';
import React, {
    useRef,
    useState
} from 'react';
import { Button } from "@/components/ui/button"
import { Upload } from 'lucide-react';
export const FileUpload: React.FC = () => {
    const [fileName, setFileName] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const openFilePicker = () => {
        fileInputRef.current?.click();
    }
    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if(!file) return;
        setFileName(file.name);
        const formData = new FormData();
        formData.append('pdfFile', file);

        try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/upload/pdf`, {
                method: 'POST',
                body: formData,
            });
            const data = await res.json();
            console.log(data)
            alert(data.message);

        } catch (error) {
            console.log(error);
        }

    }

    return (<div className='flex justify-center items-center h-screen'>
        <div className='text-center'>

            <Button variant="outline" className='p-4' onClick={openFilePicker}>
                {fileName ? (
                <span>{fileName}</span>
                ) : (
                <span className="flex items-center gap-2">
                    Upload File <Upload />
                </span>
                )}
            </Button>
           {fileName && <p className='text-xs pt-2'>uploaded successfully!</p>}
            <input ref={fileInputRef} accept="application/pdf" type="file" className="hidden" onChange={handleFileChange} />

        </div>
            </div>)

}