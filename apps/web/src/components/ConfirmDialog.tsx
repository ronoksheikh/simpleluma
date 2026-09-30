import { Button, Modal } from '@heroui/react';

interface Props {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({ isOpen, title, message, confirmLabel, onConfirm, onClose }: Props) {
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Modal.Container size="sm">
        <Modal.Dialog>
          <Modal.Header>
            <Modal.Heading>{title}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <p className="text-night/70">{message}</p>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="ghost" onPress={onClose}>Cancel</Button>
            <Button variant="danger" onPress={() => { onConfirm(); onClose(); }}>{confirmLabel}</Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
