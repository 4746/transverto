export interface ILabelDeleteRowReport {
  code: string;
  labels: string[];
  status: string;
}

export interface ISyncRowReport {
  [landCode: string]: string;
  id?: string;
  label: string;
}
