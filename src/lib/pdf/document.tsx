import "server-only";

/* eslint-disable jsx-a11y/alt-text -- react-pdf <Image> is drawn into the PDF and has no alt attribute. */

import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

/*
 * One A4 layout for the M7 documents (SPEC 10.1; FR-14, FR-25): statement of account, demand
 * notice, collateral receipt and collateral release letter. Each carries the company header from
 * settings.company, its number, generation time, the preparer and a QR code to /verify/<token>.
 * The caller passes finished text (amounts and dates already formatted); this file only lays out.
 */
export type Block =
  | { type: "details"; heading?: string; items: Array<{ label: string; value: string }>; boxed?: boolean }
  | {
      type: "table";
      heading?: string;
      columns: Array<{ label: string; width: string; align?: "left" | "right" }>;
      rows: string[][];
      total?: string[];
    }
  | { type: "text"; heading?: string; text: string; strong?: boolean }
  | { type: "images"; heading?: string; images: Buffer[] }
  | { type: "signatures"; items: Array<{ label: string; name: string }>; dateLine?: string };

export interface DocumentData {
  company: { name: string; contact: string; logo: Buffer | null };
  title: string;
  subtitle?: string;
  number: string;
  generatedAt: string;
  preparedBy: string;
  qrDataUrl: string;
  verifyUrl: string;
  verifyLabel: string;
  voidLabel?: string;
  blocks: Block[];
}

const colors = {
  primary: "#32207E",
  ink: "#0F172A",
  muted: "#475569",
  line: "#CBD5E1",
  tint: "#F1F5F9",
  void: "#B91C1C",
};

const styles = StyleSheet.create({
  page: {
    padding: 36,
    paddingBottom: 96,
    fontSize: 9.5,
    color: colors.ink,
    fontFamily: "Helvetica",
    lineHeight: 1.4,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 14,
  },
  brand: { flexDirection: "row", alignItems: "center", gap: 10 },
  logo: { width: 46, height: 46, objectFit: "contain" },
  company: { fontSize: 13, fontFamily: "Helvetica-Bold", color: colors.primary },
  muted: { color: colors.muted },
  strong: { fontFamily: "Helvetica-Bold" },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold", lineHeight: 1.25, marginBottom: 4 },
  section: { marginTop: 12 },
  heading: { fontSize: 10.5, fontFamily: "Helvetica-Bold", color: colors.primary, marginBottom: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: "50%", marginBottom: 4, paddingRight: 8 },
  label: { fontSize: 8, color: colors.muted },
  box: { backgroundColor: colors.tint, padding: 8, borderRadius: 4 },
  table: { borderTopWidth: 1, borderColor: colors.line },
  row: { flexDirection: "row", borderBottomWidth: 1, borderColor: colors.line, paddingVertical: 3 },
  th: { fontSize: 8, color: colors.muted, fontFamily: "Helvetica-Bold" },
  images: { flexDirection: "row", gap: 8 },
  photo: { width: 150, height: 110, objectFit: "cover", borderRadius: 4 },
  signatures: { flexDirection: "row", gap: 18, marginTop: 28 },
  signature: { flex: 1, borderTopWidth: 1, borderColor: colors.ink, paddingTop: 4 },
  footer: {
    position: "absolute",
    left: 36,
    right: 36,
    bottom: 24,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  qr: { width: 64, height: 64 },
  stamp: {
    position: "absolute",
    top: 320,
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 96,
    fontFamily: "Helvetica-Bold",
    color: colors.void,
    opacity: 0.2,
    transform: "rotate(-20deg)",
  },
});

function BlockView({ block }: { block: Block }) {
  const heading =
    "heading" in block && block.heading !== undefined ? (
      <Text style={styles.heading}>{block.heading}</Text>
    ) : null;
  switch (block.type) {
    case "details":
      return (
        <View style={styles.section} wrap={false}>
          {heading}
          <View style={block.boxed === true ? [styles.grid, styles.box] : styles.grid}>
            {block.items.map((item) => (
              <View key={item.label} style={styles.cell}>
                <Text style={styles.label}>{item.label}</Text>
                <Text style={styles.strong}>{item.value}</Text>
              </View>
            ))}
          </View>
        </View>
      );
    case "table":
      return (
        <View style={styles.section}>
          {heading}
          <View style={styles.table}>
            <View style={styles.row} fixed>
              {block.columns.map((column) => (
                <Text
                  key={column.label}
                  style={[styles.th, { width: column.width, textAlign: column.align ?? "left" }]}
                >
                  {column.label}
                </Text>
              ))}
            </View>
            {block.rows.map((row, index) => (
              <View key={index} style={styles.row} wrap={false}>
                {row.map((value, column) => (
                  <Text
                    key={column}
                    style={{
                      width: block.columns[column]?.width,
                      textAlign: block.columns[column]?.align ?? "left",
                    }}
                  >
                    {value}
                  </Text>
                ))}
              </View>
            ))}
            {block.total !== undefined ? (
              <View style={styles.row} wrap={false}>
                {block.total.map((value, column) => (
                  <Text
                    key={column}
                    style={[
                      styles.strong,
                      {
                        width: block.columns[column]?.width,
                        textAlign: block.columns[column]?.align ?? "left",
                      },
                    ]}
                  >
                    {value}
                  </Text>
                ))}
              </View>
            ) : null}
          </View>
        </View>
      );
    case "text":
      return (
        <View style={styles.section}>
          {heading}
          <Text style={block.strong === true ? styles.strong : {}}>{block.text}</Text>
        </View>
      );
    case "images":
      return block.images.length === 0 ? null : (
        <View style={styles.section} wrap={false}>
          {heading}
          <View style={styles.images}>
            {block.images.map((image, index) => (
              <Image key={index} src={image} style={styles.photo} />
            ))}
          </View>
        </View>
      );
    case "signatures":
      return (
        <View wrap={false}>
          <View style={styles.signatures}>
            {block.items.map((item) => (
              <View key={item.label + item.name} style={styles.signature}>
                <Text>{item.label}</Text>
                <Text style={styles.muted}>{item.name}</Text>
              </View>
            ))}
          </View>
          {block.dateLine !== undefined ? (
            <Text style={[styles.muted, { marginTop: 8 }]}>{block.dateLine}</Text>
          ) : null}
        </View>
      );
  }
}

function OfficialDocument({ data }: { data: DocumentData }) {
  return (
    <Document title={`${data.title} ${data.number}`} author={data.company.name}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.brand}>
            {data.company.logo !== null ? <Image src={data.company.logo} style={styles.logo} /> : null}
            <View>
              <Text style={styles.company}>{data.company.name}</Text>
              {data.company.contact !== "" ? <Text style={styles.muted}>{data.company.contact}</Text> : null}
            </View>
          </View>
          <View>
            <Text style={styles.strong}>{data.number}</Text>
            <Text style={styles.muted}>{data.generatedAt}</Text>
          </View>
        </View>
        <Text style={styles.title}>{data.title}</Text>
        {data.subtitle !== undefined ? <Text style={styles.muted}>{data.subtitle}</Text> : null}
        {data.blocks.map((block, index) => (
          <BlockView key={index} block={block} />
        ))}
        {data.voidLabel !== undefined ? (
          <Text style={styles.stamp} fixed>
            {data.voidLabel}
          </Text>
        ) : null}
        <View style={styles.footer} fixed>
          <View>
            <Text style={styles.muted}>{data.preparedBy}</Text>
            <Text style={styles.muted}>{data.verifyLabel}</Text>
            <Text style={styles.muted}>{data.verifyUrl}</Text>
            <Text
              style={styles.muted}
              render={({ pageNumber, totalPages }) => (totalPages > 1 ? `${pageNumber} / ${totalPages}` : "")}
            />
          </View>
          <Image src={data.qrDataUrl} style={styles.qr} />
        </View>
      </Page>
    </Document>
  );
}

export function renderOfficialDocument(data: DocumentData): Promise<Buffer> {
  return renderToBuffer(<OfficialDocument data={data} />);
}
