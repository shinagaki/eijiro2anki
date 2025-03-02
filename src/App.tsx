import { useState } from 'react';
import './App.css';

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
  const [progress, setProgress] = useState<string>('');

  const updateProgress = (message: string) => {
    console.log(message);
    setProgress(message);
  };

  const normalizeWord = (line: string): string => {
    // ■記号を除去し、最初の空白または{までの部分を取得して空白を除去
    return line.replace('■', '').split(/[\s{]/)[0].trim();
  };

  const parseEntry = (lines: string[]): DictionaryEntry | null => {
    if (lines.length < 2) return null; // 定義行とメタ情報行の最低2行が必要

    const word = normalizeWord(lines[0]);

    // 1. まず定義行を収集
    const definitions: string[] = [];
    let definitionLines = 0;

    // メタ情報行以外の行を定義として処理
    for (const line of lines) {
      if (line.includes('【レベル】')) {
        break; // メタ情報行に到達したら定義の処理を終了
      }
      definitionLines++;

      if (!line.startsWith(`■${word}`)) continue;

      const parts = line.split('  ');
      if (parts.length < 2) continue;

      // 品詞情報と定義部分を抽出
      const contentPart = parts.slice(1).join('  ');
      if (!contentPart.includes(' : ')) continue;

      const [prefix, ...defParts] = contentPart.split(' : ');
      const definition = defParts.join(' : ')
        .trim()
        .replace(/■・/g, '<br>・'); // 例文の区切りを<br>に変換

      if (prefix && definition) {
        definitions.push(`${prefix} : ${definition}`);
      }
    }

    // 定義が見つからない場合はスキップ
    if (definitions.length === 0) return null;

    // 2. メタ情報行を処理
    const metaLine = lines[definitionLines]; // 定義の次の行がメタ情報行のはず
    if (!metaLine || !metaLine.includes('【レベル】')) return null;

    // メタ情報を抽出
    const levelMatch = metaLine.match(/【レベル】(\d+)/);
    const pronunciationMatch = metaLine.match(/【発音】(.*?)(?:、|$)/);
    const conjugationMatch = metaLine.match(/【変化】(.*?)(?:、|$)/);
    const segmentationMatch = metaLine.match(/【分節】(.*?)(?:、|$)/);

    if (!levelMatch) return null;

    // カタカナ発音の抽出（最後の「、」は除去）
    const kanaMatch = metaLine.match(/【＠】(.*?)(?:【|$)/);
    const kana = kanaMatch ? kanaMatch[1].replace(/、$/, '') : '';

    const metaInfo = {
      level: levelMatch[1],
      pronunciation: pronunciationMatch ? pronunciationMatch[1] : '',
      kana: kana,
      conjugation: conjugationMatch ? conjugationMatch[1] : '',
      segmentation: segmentationMatch ? segmentationMatch[1] : ''
    };

    // 3. エントリーを作成
    const entry = {
      id: 0,
      word,
      definitions,
      level: metaInfo.level,
      pronunciation: metaInfo.pronunciation,
      kana: metaInfo.kana,
      conjugation: metaInfo.conjugation,
      segmentation: metaInfo.segmentation
    };

    return entry;
  };

  const processEijiroData = (text: string): DictionaryEntry[] => {
    const lines = text.split('\n');
    const entries: DictionaryEntry[] = [];
    let currentWord = '';
    let currentLines: string[] = [];
    let id = 1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line === '') {
        continue;
      }

      const word = normalizeWord(line);

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
      currentLines.push(line); 
    }

    // 最後の単語グループを処理
    if (currentLines.length > 0) {
      const entry = parseEntry(currentLines);
      if (entry) {
        entry.id = id++;
        entries.push(entry);
      }
    }

    return entries;
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      console.error('ファイルが選択されていません');
      return;
    }

    try {
      setIsProcessing(true);
      updateProgress(`ファイル "${file.name}" (${(file.size / 1024 / 1024).toFixed(2)}MB) を読み込んでいます...`);

      // ファイルをArrayBufferとして読み込む
      const buffer = await file.arrayBuffer();
      // Shift-JISデコーダーを使用してテキストに変換
      const decoder = new TextDecoder('shift-jis');
      const text = decoder.decode(buffer);

      updateProgress('ファイルの読み込みが完了しました。データの処理を開始します...');

      const processedEntries = processEijiroData(text);
      updateProgress(`処理が完了しました。${processedEntries.length.toLocaleString()}件のエントリーが見つかりました。`);
      setEntries(processedEntries);
    } catch (error) {
      if (error instanceof TypeError && error.message.includes('shift-jis')) {
        console.error('Shift-JISデコードに失敗しました。UTF-8で再試行します...');
        try {
          const text = await file.text();  // UTF-8でのフォールバック
          const processedEntries = processEijiroData(text);
          updateProgress(`処理が完了しました。${processedEntries.length.toLocaleString()}件のエントリーが見つかりました。`);
          setEntries(processedEntries);
        } catch (fallbackError) {
          console.error('UTF-8での読み込みにも失敗しました:', fallbackError);
          updateProgress('ファイルの読み込みに失敗しました。ファイルが破損しているか、対応していないエンコーディングの可能性があります。');
        }
      } else {
        console.error('エラーが発生しました:', error);
        updateProgress(`エラーが発生しました: ${error instanceof Error ? error.message : '不明なエラー'}`);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadCsv = () => {
    try {
      updateProgress('CSVファイルの作成を開始します...');

      const header = 'ID,見出語,定義,発音,カタカナ発音,変化,レベル,分節\n';
      const csvContent = header + entries.map(entry => {
        // 定義をひとつの文字列に結合
        const definitions = entry.definitions.join('<br>');

        // CSVフィールドのエスケープ処理
        const escapeCsvField = (field: string) => {
          if (field.includes(',') || field.includes('"') || field.includes('\n')) {
            return `"${field.replace(/"/g, '""')}"`;
          }
          return field;
        };

        return [
          entry.id,
          escapeCsvField(entry.word),
          escapeCsvField(definitions),
          escapeCsvField(entry.pronunciation),
          escapeCsvField(entry.kana),
          escapeCsvField(entry.conjugation),
          entry.level,
          escapeCsvField(entry.segmentation)
        ].join(',');
      }).join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);

      updateProgress('ダウンロードを開始します...');
      const a = document.createElement('a');
      a.href = url;
      a.download = 'anki_cards.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      updateProgress('ダウンロードが完了しました');
    } catch (error) {
      console.error('CSVダウンロード中にエラーが発生しました:', error);
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>英辞郎 辞書データ → Anki用CSVファイル変換ツール</h1>
        <div style={{ margin: '20px 0' }}>
          <input
            type="file"
            accept=".txt"
            onChange={handleFileUpload}
            style={{ margin: '10px 0' }}
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
            <p>{entries.length.toLocaleString()}件のエントリーが読み込まれました</p>
            <button type="button" onClick={downloadCsv}>CSVをダウンロード</button>
          </div>
        )}
      </header>
    </div>
  );
}

export default App;
