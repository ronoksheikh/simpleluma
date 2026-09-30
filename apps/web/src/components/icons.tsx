import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 18, children, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      {children}
    </svg>
  );
}

export const CheckIcon = (p: IconProps) => <Icon {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Icon>;
export const XIcon = (p: IconProps) => <Icon {...p}><path d="M6 6l12 12M18 6 6 18" /></Icon>;
export const PlusIcon = (p: IconProps) => <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>;
export const SendIcon = (p: IconProps) => <Icon {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Icon>;
export const StopIcon = (p: IconProps) => <Icon {...p}><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></Icon>;
export const PaperclipIcon = (p: IconProps) => <Icon {...p}><path d="m20 11-8.6 8.6a5 5 0 0 1-7-7L13 4a3.5 3.5 0 0 1 5 5l-8.6 8.6a2 2 0 0 1-3-3L14 7" /></Icon>;
export const ShareIcon = (p: IconProps) => <Icon {...p}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1" /></Icon>;
export const DownloadIcon = (p: IconProps) => <Icon {...p}><path d="M12 4v11M7 11l5 5 5-5M5 20h14" /></Icon>;
export const TrashIcon = (p: IconProps) => <Icon {...p}><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" /></Icon>;
export const RestoreIcon = (p: IconProps) => <Icon {...p}><path d="M4 12a8 8 0 1 0 3-6.2M4 4v5h5" /></Icon>;
export const ChevronIcon = (p: IconProps) => <Icon {...p}><path d="m9 6 6 6-6 6" /></Icon>;
export const TerminalIcon = (p: IconProps) => <Icon {...p}><path d="m5 8 4 4-4 4M12 17h7" /></Icon>;
export const PlayIcon = (p: IconProps) => <Icon {...p}><path d="M8 5v14l11-7z" fill="currentColor" /></Icon>;
export const FileIcon = (p: IconProps) => <Icon {...p}><path d="M7 3h7l5 5v13H7zM14 3v5h5" /></Icon>;
export const CopyIcon = (p: IconProps) => <Icon {...p}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h8" /></Icon>;
export const SparkIcon = (p: IconProps) => <Icon {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" /></Icon>;
export const GearIcon = (p: IconProps) => <Icon {...p}><circle cx="12" cy="12" r="3" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8" /></Icon>;
