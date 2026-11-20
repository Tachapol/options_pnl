"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

type ImportModalContextType = {
  isOpen: boolean;
  accountId?: string;
  openModal: (accountId?: string) => void;
  closeModal: () => void;
};

const ImportModalContext = createContext<ImportModalContextType>({
  isOpen: false,
  openModal: () => {},
  closeModal: () => {},
});

export function ImportModalProvider({ children, initialAccount }: { children: ReactNode; initialAccount?: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [accountId, setAccountId] = useState<string | undefined>(initialAccount);

  const openModal = (id?: string) => {
    if (id) setAccountId(id);
    setIsOpen(true);
  };

  const closeModal = () => {
    setIsOpen(false);
  };

  return (
    <ImportModalContext.Provider value={{ isOpen, accountId, openModal, closeModal }}>
      {children}
    </ImportModalContext.Provider>
  );
}

export function useImportModal() {
  return useContext(ImportModalContext);
}
