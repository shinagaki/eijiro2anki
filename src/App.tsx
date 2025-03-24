import { useState } from "react";
import "./App.css";

interface DictionaryEntry {
	id: number;
	word: string;
	definitions: string[];
	pronunciation: string;
	kana: string;
	conjugation: string;
	level: string;
	segmentation: string;
}

function App() {
	const [entries, setEntries] = useState<DictionaryEntry[]>([]);
	const [isProcessing, setIsProcessing] = useState(false);
	const [progress, setProgress] = useState<string>("");

	const updateProgress = (message: string) => {
		console.log(message);
		setProgress(message);
	};

	const removeSymbols = (line: string): string => {
		return line.replace("■", "");
	};

	const extractFirstWord = (line: string): string => {
		return line.split(/[\s{]/)[0].trim();
	};

	const normalizeWord = (line: string): string => {
		const lineWithoutSymbols = removeSymbols(line);
		return extractFirstWord(lineWithoutSymbols);
	};

	interface MetaInfo {
		level: string;
		pronunciation: string;
		kana: string;
		conjugation: string;
		segmentation: string;
	}

	const extractDefinitions = (lines: string[], word: string): string[] => {
		const definitions: string[] = [];
		for (const line of lines) {
			if (line.includes("【レベル】")) {
				break;
			}
			if (!line.startsWith(`■${word}`)) continue;

			const parts = line.split("  ");
			if (parts.length < 2) continue;

			const contentPart = parts.slice(1).join("  ");
			if (!contentPart.includes(" : ")) continue;

			const [prefix, ...defParts] = contentPart.split(" : ");
			const definition = defParts.join(" : ").trim().replace(/■・/g, "<br>・");

			if (prefix && definition) {
				definitions.push(`${prefix} : ${definition}`);
			}
		}
		return definitions;
	};

	const extractMetaInfo = (metaLine: string): MetaInfo | null => {
		if (!metaLine || !metaLine.includes("【レベル】")) return null;

		const levelMatch = metaLine.match(/【レベル】(\d+)/);
		const pronunciationMatch = metaLine.match(/【発音】(.*?)(?:、|$)/);
		const conjugationMatch = metaLine.match(/【変化】(.*?)(?:、|$)/);
		const segmentationMatch = metaLine.match(/【分節】(.*?)(?:、|$)/);

		if (!levelMatch) return null;

		const kanaMatch = metaLine.match(/【＠】(.*?)(?:【|$)/);
		const kana = kanaMatch ? kanaMatch[1].replace(/、$/, "") : "";

		return {
			level: levelMatch[1],
			pronunciation: pronunciationMatch ? pronunciationMatch[1] : "",
			kana: kana,
			conjugation: conjugationMatch ? conjugationMatch[1] : "",
			segmentation: segmentationMatch ? segmentationMatch[1] : "",
		};
	};

	const parseEntry = (lines: string[]): DictionaryEntry | null => {
		if (lines.length < 2) return null;

		const word = normalizeWord(lines[0]);
		let definitionLines = 0;
		const definitions = extractDefinitions(lines, word);

		if (definitions.length === 0) return null;

		for (const line of lines) {
			if (line.includes("【レベル】")) {
				break;
			}
			definitionLines++;
		}

		const metaLine = lines[definitionLines];
		const metaInfo = extractMetaInfo(metaLine);

		if (!metaInfo) return null;

		return {
			id: 0,
			word,
			definitions,
			level: metaInfo.level,
			pronunciation: metaInfo.pronunciation,
			kana: metaInfo.kana,
			conjugation: metaInfo.conjugation,
			segmentation: metaInfo.segmentation,
		};
	};

	const processEijiroData = (text: string): DictionaryEntry[] => {
		const lines = text.split("\n");
		let entries: DictionaryEntry[] = [];
		let currentWord = "";
		let currentLines: string[] = [];
		let id = 1;

		for (const line of lines) {
			const trimmedLine = line.trim();
			if (trimmedLine === "") {
				continue;
			}

			const word = normalizeWord(trimmedLine);

			if (word !== currentWord) {
				if (currentLines.length > 0) {
					const entry = parseEntry(currentLines);
					if (entry) {
						entry.id = id++;
						entries.push(entry);
					}
				}
				currentLines = [];
				currentWord = word;
			}
			currentLines.push(trimmedLine);
		}

		if (currentLines.length > 0) {
			const entry = parseEntry(currentLines);
			if (entry) {
				entry.id = id++;
				entries.push(entry);
			}
		}

		entries = entries.filter((entry) => entry !== null) as DictionaryEntry[];
		return entries;
	};

	const SHIFT_JIS = "shift-jis";
	const UTF_8 = "utf-8";

	const handleFileUpload = async (
		event: React.ChangeEvent<HTMLInputElement>,
	) => {
		const file = event.target.files?.[0];
		if (!file) {
			console.error("ファイルが選択されていません");
			return;
		}

		setIsProcessing(true);
		try {
			updateProgress(
				`ファイル "${file.name}" (${(file.size / 1024 / 1024).toFixed(2)}MB) を読み込んでいます...`,
			);

			const buffer = await file.arrayBuffer();
			let text: string;
			try {
				const decoder = new TextDecoder(SHIFT_JIS);
				text = decoder.decode(buffer);
			} catch (shiftJisError) {
				console.warn("Shift-JISデコードに失敗しました。UTF-8で再試行します...");
				try {
					text = await file.text();
				} catch (utf8Error) {
					console.error("UTF-8での読み込みにも失敗しました:", utf8Error);
					updateProgress(
						"ファイルの読み込みに失敗しました。ファイルが破損しているか、対応していないエンコーディングの可能性があります。",
					);
					return;
				}
			}

			updateProgress(
				"ファイルの読み込みが完了しました。データの処理を開始します...",
			);

			const processedEntries = processEijiroData(text);
			updateProgress(
				`処理が完了しました。${processedEntries.length.toLocaleString()}件のエントリーが見つかりました。`,
			);
			setEntries(processedEntries);
		} catch (error) {
			console.error("エラーが発生しました:", error);
			updateProgress(
				`エラーが発生しました: ${error instanceof Error ? error.message : "不明なエラー"}`,
			);
		} finally {
			setIsProcessing(false);
		}
	};

	const CSV_HEADER = "ID,見出語,定義,発音,カタカナ発音,変化,レベル,分節\n";
	const CSV_MIME_TYPE = "text/csv";
	const CSV_FILE_NAME = "anki_cards.csv";

	const escapeCsvField = (field: string) => {
		if (field.includes(",") || field.includes('"') || field.includes("\n")) {
			return `"${field.replace(/"/g, '""')}"`;
		}
		return field;
	};

	const downloadCsv = () => {
		try {
			updateProgress("CSVファイルの作成を開始します...");

			const csvContent =
				CSV_HEADER +
				entries
					.map((entry) => {
						const definitions = entry.definitions.join("<br>");

						return [
							entry.id,
							escapeCsvField(entry.word),
							escapeCsvField(definitions),
							escapeCsvField(entry.pronunciation),
							escapeCsvField(entry.kana),
							escapeCsvField(entry.conjugation),
							entry.level,
							escapeCsvField(entry.segmentation),
						].join(",");
					})
					.join("\n");

			const blob = new Blob([csvContent], { type: CSV_MIME_TYPE });
			const url = window.URL.createObjectURL(blob);

			updateProgress("ダウンロードを開始します...");
			const a = document.createElement("a");
			a.href = url;
			a.download = CSV_FILE_NAME;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			window.URL.revokeObjectURL(url);

			updateProgress("ダウンロードが完了しました");
		} catch (error) {
			console.error("CSVダウンロード中にエラーが発生しました:", error);
		}
	};

	return (
		<div className="App">
			<header className="App-header">
				<h1>英辞郎 辞書データ → Anki用CSVファイル変換ツール</h1>
				<div style={{ margin: "20px 0" }}>
					<input
						type="file"
						accept=".txt"
						onChange={handleFileUpload}
						style={{ margin: "10px 0" }}
					/>
				</div>
				{isProcessing && (
					<div>
						<p>処理中...</p>
						<p className="progress">{progress}</p>
					</div>
				)}
				{entries.length > 0 && !isProcessing && (
					<div className="result">
						<p>
							{entries.length.toLocaleString()}件のエントリーが読み込まれました
						</p>
						<button type="button" onClick={downloadCsv}>
							CSVをダウンロード
						</button>
					</div>
				)}
			</header>
		</div>
	);
}

export default App;
