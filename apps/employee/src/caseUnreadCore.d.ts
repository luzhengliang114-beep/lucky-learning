export type CaseAcknowledgementItem = {
  status?: string;
  acknowledgementRequired?: boolean;
  acknowledgementStatus?: string;
};

export function caseUnreadCount(cases?: CaseAcknowledgementItem[], isSupplier?: boolean): number;
export function caseUnreadLabel(count?: number): string;
