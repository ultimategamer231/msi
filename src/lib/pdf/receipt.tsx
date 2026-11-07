import "server-only";

/* eslint-disable jsx-a11y/alt-text -- react-pdf <Image> is drawn into the PDF and has no alt attribute. */

import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

/*
 * Payment receipt (SPEC 10.1; FR-25), A5 or an 80 mm roll: receipt no., date, customer, loan,
 * amount, method and reference, allocation, balance after, received by, branch, QR code to
 * /verify/<token>, and a VOID stamp when the payment was voided. All values arrive formatted.
 */
export type ReceiptLabels = Record<
  | "official"
  | "number"
  | "date"
  | "from"
  | "loan"
  | "method"
  | "amount"
  | "penalty"
  | "interest"
  | "principal"
  | "balanceAfter"
  | "receivedBy"
  | "printed"
  | "scan"
  | "void",
  string
>;

export interface ReceiptPdfData {
  paper: "a5" | "80mm";
  company: { name: string; contact: string; footer: string; logo: Buffer | null };
  receiptNo: string;
  date: string;
  customer: string;
  loanNo: string;
  method: string;
  amount: string;
  allocation: { penalty: string; interest: string; principal: string };
  balanceAfter: string;
  receivedBy: string;
  isVoid: boolean;
  qrDataUrl: string;
  labels: ReceiptLabels;
}

const colors = {
  primary: "#32207E",
  ink: "#0F172A",
  muted: "#475569",
  line: "#CBD5E1",
  tint: "#EEEAF8",
  void: "#B91C1C",
};

function sheetStyles(paper: ReceiptPdfData["paper"]) {
  const narrow = paper === "80mm";
  return StyleSheet.create({
    page: {
      padding: narrow ? 10 : 28,
      fontSize: narrow ? 8 : 10,
      color: colors.ink,
      fontFamily: "Helvetica",
      lineHeight: 1.35,
    },
    header: {
      alignItems: "center",
      borderBottomWidth: 1,
      borderStyle: "dashed",
      borderColor: colors.line,
      paddingBottom: 8,
    },
    logo: { width: narrow ? 40 : 56, height: narrow ? 40 : 56, objectFit: "contain", marginBottom: 4 },
    company: {
      fontSize: narrow ? 10 : 13,
      fontFamily: "Helvetica-Bold",
      color: colors.primary,
      textTransform: "uppercase",
    },
    muted: { color: colors.muted },
    official: { fontFamily: "Helvetica-Bold", marginTop: 3 },
    rows: { paddingVertical: 8 },
    row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 3, gap: 8 },
    strong: { fontFamily: "Helvetica-Bold" },
    amount: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      backgroundColor: colors.tint,
      borderRadius: 4,
      padding: narrow ? 6 : 10,
      color: colors.primary,
    },
    amountValue: { fontSize: narrow ? 13 : 18, fontFamily: "Helvetica-Bold" },
    split: {
      marginTop: 8,
      paddingTop: 8,
      borderTopWidth: 1,
      borderStyle: "dashed",
      borderColor: colors.line,
    },
    total: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: 4,
      paddingTop: 5,
      borderTopWidth: 1,
      borderColor: colors.line,
    },
    footer: {
      flexDirection: narrow ? "column" : "row",
      justifyContent: "space-between",
      alignItems: narrow ? "center" : "flex-end",
      marginTop: 12,
      gap: 8,
    },
    qr: { width: narrow ? 72 : 80, height: narrow ? 72 : 80 },
    stamp: {
      position: "absolute",
      top: narrow ? 120 : 200,
      left: 0,
      right: 0,
      textAlign: "center",
      fontSize: narrow ? 40 : 72,
      fontFamily: "Helvetica-Bold",
      color: colors.void,
      opacity: 0.25,
      transform: "rotate(-20deg)",
    },
  });
}

function ReceiptDocument({ data }: { data: ReceiptPdfData }) {
  const s = sheetStyles(data.paper);
  const l = data.labels;
  const rows: Array<[string, string, boolean]> = [
    [l.number, data.receiptNo, true],
    [l.date, data.date, false],
    [l.from, data.customer, true],
    [l.loan, data.loanNo, false],
    [l.method, data.method, false],
  ];
  return (
    <Document title={data.receiptNo} author={data.company.name} subject={data.loanNo}>
      <Page size={data.paper === "80mm" ? [227, 600] : "A5"} style={s.page}>
        <View style={s.header}>
          {data.company.logo !== null ? <Image src={data.company.logo} style={s.logo} /> : null}
          <Text style={s.company}>{data.company.name}</Text>
          {data.company.contact !== "" ? <Text style={s.muted}>{data.company.contact}</Text> : null}
          <Text style={s.official}>{data.isVoid ? `${l.official} · ${l.void}` : l.official}</Text>
        </View>
        <View style={s.rows}>
          {rows.map(([label, value, strong]) => (
            <View key={label} style={s.row}>
              <Text style={s.muted}>{label}</Text>
              <Text style={strong ? s.strong : {}}>{value}</Text>
            </View>
          ))}
        </View>
        <View style={s.amount}>
          <Text style={s.strong}>{l.amount}</Text>
          <Text style={s.amountValue}>{data.amount}</Text>
        </View>
        <View style={s.split}>
          {(
            [
              [l.penalty, data.allocation.penalty],
              [l.interest, data.allocation.interest],
              [l.principal, data.allocation.principal],
            ] as const
          ).map(([label, value]) => (
            <View key={label} style={s.row}>
              <Text style={s.muted}>{label}</Text>
              <Text>{value}</Text>
            </View>
          ))}
          <View style={s.total}>
            <Text style={s.strong}>{l.balanceAfter}</Text>
            <Text style={s.strong}>{data.balanceAfter}</Text>
          </View>
        </View>
        <View style={s.footer}>
          <View>
            <Text style={s.muted}>{l.receivedBy}</Text>
            <Text style={s.strong}>{data.receivedBy}</Text>
            <Text style={s.muted}>{l.printed}</Text>
            {data.company.footer !== "" ? <Text style={s.muted}>{data.company.footer}</Text> : null}
          </View>
          <View style={{ alignItems: "center" }}>
            <Image src={data.qrDataUrl} style={s.qr} />
            <Text style={s.muted}>{l.scan}</Text>
          </View>
        </View>
        {data.isVoid ? <Text style={s.stamp}>{l.void}</Text> : null}
      </Page>
    </Document>
  );
}

export async function renderReceipt(data: ReceiptPdfData): Promise<Buffer> {
  return renderToBuffer(<ReceiptDocument data={data} />);
}
