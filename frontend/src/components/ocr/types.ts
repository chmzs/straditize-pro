export interface OcrLabelEntry {
  id: string;
  ocr_text: string;
  suggested_name: string;
  suggested_zh: string;
  group: string;
  cls?: string;
  confidence: number;
  status: 'auto' | 'confirm' | 'unrecognized';
  bbox: Array<[number, number]>;
  anchor_x: number;
  anchor_y: number;
  associated_column_id?: string | null;
  associated_column_index?: number | null;
  associated_column_name?: string | null;
  user_override_name?: string;
  accepted?: boolean;
}

export interface OcrRecognitionResult {
  labels: OcrLabelEntry[];
  label_row_bbox: [number, number, number, number];
  label_row_image: string; // base64
  summary: {
    total: number;
    auto: number;
    confirm: number;
    unrecognized: number;
  };
}
