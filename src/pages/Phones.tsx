import { useMemo, useState } from "react";
import api from "../lib/api";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Badge } from "../components/ui/badge";
import { toast } from "sonner";

type TabKey = "brands" | "sold" | "all" | "vector";

type VectorMatch = {
  id: string;
  score?: number;
  metadata: Record<string, unknown>;
};

function safeString(v: unknown) {
  if (v === null || v === undefined) return "";
  return String(v);
}

export default function Phones() {
  const [tab, setTab] = useState<TabKey>("vector");
  const [vectorAdminSupported, setVectorAdminSupported] = useState(true);

  // Vector editor state
  const [searchQ, setSearchQ] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [matches, setMatches] = useState<VectorMatch[]>([]);

  const [selectedId, setSelectedId] = useState<string>("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [variant, setVariant] = useState("");
  const [price, setPrice] = useState<string>("");
  const [image, setImage] = useState("");
  const [link, setLink] = useState("");
  const [extraJson, setExtraJson] = useState("{}");
  const [saveLoading, setSaveLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // CSV upload state
  const [csvFileName, setCsvFileName] = useState<string>("");
  const [csvText, setCsvText] = useState<string>("");
  const [csvUploading, setCsvUploading] = useState(false);

  const canSave = useMemo(() => {
    return brand.trim().length > 0 && model.trim().length > 0;
  }, [brand, model]);

  const resetForm = () => {
    setSelectedId("");
    setBrand("");
    setModel("");
    setVariant("");
    setPrice("");
    setImage("");
    setLink("");
    setExtraJson("{}");
  };

  const pickMatch = (m: VectorMatch) => {
    const md = m.metadata || {};
    setSelectedId(m.id);
    setBrand(safeString(md.brand));
    setModel(safeString(md.model));
    setVariant(safeString(md.variant));
    setPrice(md.price === undefined || md.price === null ? "" : String(md.price));
    setImage(safeString(md.image));
    setLink(safeString(md.link));

    const knownKeys = new Set(["brand", "model", "variant", "price", "image", "link"]);
    const extras: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(md)) {
      if (knownKeys.has(k)) continue;
      extras[k] = v;
    }
    setExtraJson(JSON.stringify(extras, null, 2));
  };

  const runSearch = async () => {
    const q = searchQ.trim();
    if (!q) {
      toast.error("Enter a search query");
      return;
    }

    setSearchLoading(true);
    try {
      const res = await api.post("/admin/vector/phones/search", { q, top_k: 10 });
      setMatches(res.data?.matches || []);
      const mode = res.data?.mode;
      const supports = mode !== "fallback_search";
      setVectorAdminSupported(supports);
      if (!supports) {
        toast.warning(
          "Vector DB admin endpoints not available on your vector service. Search works, but Save/Delete require running the updated vector backend locally (or deploying it)."
        );
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      toast.error(e?.response?.data?.message || e?.message || "Search failed");
    } finally {
      setSearchLoading(false);
    }
  };

  const savePhone = async () => {
    if (!vectorAdminSupported) {
      toast.error(
        "Save requires vector admin endpoints. Set VECTOR_BACKEND_URL to your updated vector backend (e.g. http://localhost:8000) and restart the Node backend."
      );
      return;
    }
    if (!canSave) {
      toast.error("Brand and model are required");
      return;
    }

    let extras: Record<string, unknown> = {};
    try {
      extras = extraJson.trim() ? JSON.parse(extraJson) : {};
      if (extras && typeof extras !== "object") throw new Error("Extras must be a JSON object");
    } catch (err: unknown) {
      const e = err as { message?: string };
      toast.error(`Invalid Extras JSON: ${e?.message || String(err)}`);
      return;
    }

    const payload: {
      id?: string;
      brand: string;
      model: string;
      variant?: string;
      image?: string;
      link?: string;
      price?: number;
      metadata?: Record<string, unknown>;
      [k: string]: unknown;
    } = {
      id: selectedId || undefined,
      brand: brand.trim(),
      model: model.trim(),
      variant: variant.trim() || undefined,
      image: image.trim() || undefined,
      link: link.trim() || undefined,
      metadata: extras,
    };

    const p = price.trim();
    if (p) {
      const n = Number(p);
      if (Number.isNaN(n)) {
        toast.error("Price must be a number");
        return;
      }
      payload.price = n;
    }

    setSaveLoading(true);
    try {
      const res = await api.post("/admin/vector/phones/upsert", payload);
      const newId = res.data?.id;
      if (newId) setSelectedId(String(newId));
      toast.success(res.data?.message || "Saved to vector DB");
      // Re-run search to reflect changes
      if (searchQ.trim()) await runSearch();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      toast.error(e?.response?.data?.message || e?.message || "Save failed");
    } finally {
      setSaveLoading(false);
    }
  };

  const onPickCsv = async (file?: File | null) => {
    if (!file) {
      setCsvFileName("");
      setCsvText("");
      return;
    }
    setCsvFileName(file.name);
    try {
      const text = await file.text();
      setCsvText(text);
    } catch (err: unknown) {
      const e = err as { message?: string };
      toast.error(e?.message || "Failed to read CSV file");
      setCsvText("");
    }
  };

  const uploadCsv = async () => {
    if (!vectorAdminSupported) {
      toast.error(
        "CSV upload requires vector admin endpoints. Set VECTOR_BACKEND_URL to your updated vector backend (e.g. http://localhost:8000) and restart the Node backend."
      );
      return;
    }
    if (!csvText.trim()) {
      toast.error("Pick a CSV file first");
      return;
    }

    setCsvUploading(true);
    try {
      const res = await api.post("/admin/vector/phones/upload-csv", { csv: csvText });
      const upserted = res.data?.upserted ?? res.data?.inserted;
      const failed = res.data?.failed;

      if (Number(upserted) > 0) {
        toast.success(`Uploaded ${upserted} rows to vector DB${failed ? ` (${failed} failed)` : ""}`);
      } else {
        toast.success(res.data?.message || "CSV processed");
      }

      // refresh search if user has a query
      if (searchQ.trim()) await runSearch();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      toast.error(e?.response?.data?.message || e?.message || "CSV upload failed");
    } finally {
      setCsvUploading(false);
    }
  };

  const deletePhone = async () => {
    if (!vectorAdminSupported) {
      toast.error(
        "Delete requires vector admin endpoints. Set VECTOR_BACKEND_URL to your updated vector backend (e.g. http://localhost:8000) and restart the Node backend."
      );
      return;
    }
    if (!selectedId) {
      toast.error("Select a vector item first");
      return;
    }

    setDeleteLoading(true);
    try {
      await api.delete(`/admin/vector/phones/${encodeURIComponent(selectedId)}`);
      toast.success("Deleted from vector DB");
      resetForm();
      if (searchQ.trim()) await runSearch();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      toast.error(e?.response?.data?.message || e?.message || "Delete failed");
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Phones</h1>
          <p className="text-gray-500 mt-1">Browse and manage phone catalog data</p>
        </div>
      </div>

      <div className="flex gap-2">
        <Button variant={tab === "brands" ? "default" : "outline"} onClick={() => setTab("brands")}>By Brand</Button>
        <Button variant={tab === "sold" ? "default" : "outline"} onClick={() => setTab("sold")}>Sold by People</Button>
        <Button variant={tab === "all" ? "default" : "outline"} onClick={() => setTab("all")}>All</Button>
        <Button variant={tab === "vector" ? "default" : "outline"} onClick={() => setTab("vector")}>Edit Vector DB</Button>
      </div>

      {tab !== "vector" ? (
        <Card>
          <CardHeader>
            <CardTitle>Coming soon</CardTitle>
            <CardDescription>
              This tab can show catalog summaries (by brand / sold / all). The vector editor below is fully functional.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-600">
              Switch to <span className="font-semibold">Edit Vector DB</span> to add/update/delete phones in the vector database.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Search vector DB</CardTitle>
              <CardDescription>Search by brand/model text, then select an item to edit</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder="e.g. iPhone 13 128GB" />
                <Button onClick={runSearch} disabled={searchLoading}>{searchLoading ? "Searching…" : "Search"}</Button>
              </div>

              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Brand</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead>Variant</TableHead>
                      <TableHead>Price</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {matches.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-gray-500">No results</TableCell>
                      </TableRow>
                    ) : (
                      matches.map((m) => (
                        <TableRow key={m.id}>
                          <TableCell className="font-mono text-xs">{m.id}</TableCell>
                          <TableCell>{safeString(m.metadata?.brand) || "-"}</TableCell>
                          <TableCell>{safeString(m.metadata?.model) || "-"}</TableCell>
                          <TableCell>
                            {safeString(m.metadata?.variant) ? (
                              <Badge variant="outline">{safeString(m.metadata?.variant)}</Badge>
                            ) : (
                              "-"
                            )}
                          </TableCell>
                          <TableCell>
                            {m.metadata && "price" in m.metadata
                              ? safeString((m.metadata as Record<string, unknown>).price) || "-"
                              : "-"}
                          </TableCell>
                          <TableCell>
                            <Button size="sm" variant="outline" onClick={() => pickMatch(m)}>Edit</Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{selectedId ? "Edit phone" : "Create new phone"}</CardTitle>
              <CardDescription>
                {selectedId ? (
                  <span>Vector ID: <span className="font-mono">{selectedId}</span></span>
                ) : (
                  "Fill brand/model and save to create a new vector entry"
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Brand *</Label>
                  <Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Apple" />
                </div>
                <div>
                  <Label>Model *</Label>
                  <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="iPhone 13" />
                </div>
                <div>
                  <Label>Variant</Label>
                  <Input value={variant} onChange={(e) => setVariant(e.target.value)} placeholder="128GB" />
                </div>
                <div>
                  <Label>Price</Label>
                  <Input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 25000" />
                </div>
                <div>
                  <Label>Image</Label>
                  <Input value={image} onChange={(e) => setImage(e.target.value)} placeholder="https://..." />
                </div>
                <div>
                  <Label>Link</Label>
                  <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://..." />
                </div>
              </div>

              <div>
                <Label>Extra metadata (JSON)</Label>
                <Textarea value={extraJson} onChange={(e) => setExtraJson(e.target.value)} rows={8} />
              </div>

              <div className="flex gap-2">
                <Button onClick={savePhone} disabled={saveLoading || !canSave || !vectorAdminSupported}>
                  {saveLoading ? "Saving…" : "Save"}
                </Button>
                <Button variant="outline" onClick={resetForm} disabled={saveLoading || deleteLoading}>
                  Clear
                </Button>
                <Button
                  variant="destructive"
                  onClick={deletePhone}
                  disabled={deleteLoading || !selectedId || !vectorAdminSupported}
                >
                  {deleteLoading ? "Deleting…" : "Delete"}
                </Button>
              </div>

              <p className="text-xs text-gray-500">
                Note: saving re-embeds this phone text (brand/model/variant) and upserts into Pinecone.
              </p>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Upload CSV</CardTitle>
              <CardDescription>
                Upload a CSV and store rows in the vector DB. Required columns: <span className="font-mono">brand,model</span>.
                Supported: <span className="font-mono">variant,price,image,link</span>. Any extra columns are saved as metadata.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                <div className="md:col-span-2">
                  <Label>CSV File</Label>
                  <Input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => onPickCsv(e.target.files?.[0])}
                  />
                  {csvFileName ? (
                    <p className="text-xs text-gray-500 mt-1">Selected: {csvFileName}</p>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <Button onClick={uploadCsv} disabled={csvUploading || !csvText.trim() || !vectorAdminSupported}>
                    {csvUploading ? "Uploading…" : "Upload"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setCsvFileName("");
                      setCsvText("");
                    }}
                    disabled={csvUploading}
                  >
                    Clear
                  </Button>
                </div>
              </div>

              <p className="text-xs text-gray-500">
                Example header: <span className="font-mono">brand,model,variant,price,link</span>
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
