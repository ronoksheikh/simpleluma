import type { Icon as PhosphorIcon, IconProps as PhosphorProps } from '@phosphor-icons/react';
import {
  ArrowClockwise, ArrowCounterClockwise, ArrowUp, Brain, CaretRight, Check, ChecksIcon, ClockCounterClockwise, Code, Copy, CornersOut, Crosshair,
  DotsThree, DownloadSimple, Eye, File, FileZip, FilmStrip, Flag, Folder, GearSix, Globe, House, Lightning, ListChecks, MagnifyingGlass, Microphone,
  Palette, Paperclip, Pause, PencilSimple, Play, Plus, ShareNetwork, SidebarSimple, SignOut, Sparkle, Stack, Stop, TerminalWindow, Trash, Warning, X,
} from '@phosphor-icons/react';

export type IconProps = PhosphorProps;

/** Phosphor icons, one consistent weight across the app. */
const make = (Base: PhosphorIcon, weight: PhosphorProps['weight'] = 'regular') => {
  const Icon = ({ size = 18, ...props }: IconProps) => <Base size={size} weight={weight} aria-hidden {...props} />;
  return Icon;
};

export const CheckIcon = make(Check, 'bold');
export const XIcon = make(X, 'bold');
export const PlusIcon = make(Plus, 'bold');
export const SendIcon = make(ArrowUp, 'bold');
export const StopIcon = make(Stop, 'fill');
export const PaperclipIcon = make(Paperclip);
export const ShareIcon = make(ShareNetwork);
export const DownloadIcon = make(DownloadSimple);
export const TrashIcon = make(Trash);
export const RestoreIcon = make(ArrowCounterClockwise);
export const ChevronIcon = make(CaretRight, 'bold');
export const TerminalIcon = make(TerminalWindow);
export const FileIcon = make(File);
export const CopyIcon = make(Copy);
export const SparkIcon = make(Sparkle);
export const GearIcon = make(GearSix);
export const HomeIcon = make(House);
export const FilmIcon = make(FilmStrip);
export const BrainIcon = make(Brain);
export const ListIcon = make(ListChecks);
export const PaletteIcon = make(Palette);
export const FolderIcon = make(Folder);
export const HistoryIcon = make(ClockCounterClockwise);
export const PlayIcon = make(Play, 'fill');
export const PauseIcon = make(Pause, 'fill');
export const RefreshIcon = make(ArrowClockwise);
export const AlertIcon = make(Warning);
export const CodeIcon = make(Code);
export const CrosshairIcon = make(Crosshair);
export const LayersIcon = make(Stack);
export const MicIcon = make(Microphone);
export const FlagIcon = make(Flag);
export const BoltIcon = make(Lightning);
export const LogoutIcon = make(SignOut);
export const SidebarIcon = make(SidebarSimple);
export const DotsIcon = make(DotsThree, 'bold');
export const ExpandIcon = make(CornersOut);
export const EyeIcon = make(Eye);
export const ZipIcon = make(FileZip);
export const ArrowUpIcon = make(ArrowUp, 'bold');
export const EditIcon = make(PencilSimple);
export const GlobeIcon = make(Globe);
export const SearchIcon = make(MagnifyingGlass);
export const ChecksDoneIcon = make(ChecksIcon);
