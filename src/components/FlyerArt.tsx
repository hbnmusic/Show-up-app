/**
 * Generated placeholder flyers. Real listings would carry the promoter's own
 * flyer images; until then every show gets a stable, xerox-style poster built
 * from its bill, date and venue.
 */
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, G, Line, Pattern, Rect } from 'react-native-svg';

import { F, hash, paletteFor, seeded, type PosterPalette } from '@/constants/theme';
import { headliner, showTitle, supportActs } from '@/lib/showText';
import { MONTHS, WEEKDAYS, formatTime } from '@/lib/time';
import type { Show } from '@/lib/types';

type Props = { show: Show; width: number; height: number };

/** Approximate glyph widths (em) for uppercase text in each face. */
const CHAR_W = { poster: 0.5, block: 0.74, mono: 0.6 };

export function fitFont(
  text: string,
  width: number,
  maxLines: number,
  charW: number,
  max: number,
  min: number,
): number {
  const words = text.toUpperCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return min;
  const longest = Math.max(...words.map((w) => w.length));
  let size = Math.min(max, width / (longest * charW));
  while (size > min) {
    const perLine = Math.max(1, Math.floor(width / (size * charW)));
    let lines = 1;
    let cur = 0;
    for (const w of words) {
      if (cur === 0) cur = w.length;
      else if (cur + 1 + w.length <= perLine) cur += 1 + w.length;
      else {
        lines++;
        cur = w.length;
      }
    }
    if (lines <= maxLines) break;
    size -= 2;
  }
  return Math.max(min, Math.floor(size));
}

function dateParts(show: Show) {
  const d = new Date(show.startsAt);
  return {
    month: MONTHS[d.getMonth()].toUpperCase(),
    day: String(d.getDate()),
    weekday: WEEKDAYS[d.getDay()].toUpperCase(),
    time: show.timeTba ? 'TIME TBA' : formatTime(d).toUpperCase(),
  };
}

function Halftone({ w, h, p, seed }: { w: number; h: number; p: PosterPalette; seed: number }) {
  const rnd = seeded(seed);
  const cx = w * (0.55 + rnd() * 0.4);
  const cy = h * (0.55 + rnd() * 0.4);
  const r = Math.max(w, h) * (0.45 + rnd() * 0.2);
  const id = `dots-${seed}`;
  return (
    <Svg width={w} height={h} style={StyleSheet.absoluteFill}>
      <Defs>
        <Pattern id={id} width={9} height={9} patternUnits="userSpaceOnUse">
          <Circle cx={4.5} cy={4.5} r={2.2} fill={p.ink} />
        </Pattern>
      </Defs>
      <Circle cx={cx} cy={cy} r={r} fill={`url(#${id})`} opacity={0.14} />
    </Svg>
  );
}

function Stripes({ w, h, p, seed }: { w: number; h: number; p: PosterPalette; seed: number }) {
  const rnd = seeded(seed);
  const gap = 14 + Math.floor(rnd() * 10);
  const lines = [];
  for (let x = -h; x < w + h; x += gap) {
    lines.push(<Line key={x} x1={x} y1={0} x2={x + h} y2={h} stroke={p.ink} strokeWidth={3} opacity={0.08} />);
  }
  return (
    <Svg width={w} height={h} style={StyleSheet.absoluteFill}>
      <G>{lines}</G>
    </Svg>
  );
}

function Grain({ w, h, p, seed }: { w: number; h: number; p: PosterPalette; seed: number }) {
  const rnd = seeded(seed);
  const specks = [];
  for (let i = 0; i < 70; i++) {
    specks.push(
      <Rect
        key={i}
        x={rnd() * w}
        y={rnd() * h}
        width={1 + rnd() * 3}
        height={1 + rnd() * 3}
        fill={p.ink}
        opacity={0.12 + rnd() * 0.2}
      />,
    );
  }
  return (
    <Svg width={w} height={h} style={StyleSheet.absoluteFill}>
      {specks}
    </Svg>
  );
}

/** Layout A: huge stacked headliner, support below, big date at the foot. */
function StackPoster({ show, width: w, height: h, p, seed }: Props & { p: PosterPalette; seed: number }) {
  const pad = Math.round(w * 0.07);
  const inner = w - pad * 2;
  const head = showTitle(show).toUpperCase();
  const support = supportActs(show).join(' / ').toUpperCase();
  const dp = dateParts(show);
  const headSize = fitFont(head, inner, 3, CHAR_W.poster, h * 0.26, 34);
  const supportSize = support ? fitFont(support, inner, 4, CHAR_W.block, 26, 12) : 0;
  return (
    <View style={[styles.poster, { width: w, height: h, backgroundColor: p.bg }]}>
      <Halftone w={w} h={h} p={p} seed={seed} />
      <View style={{ padding: pad, flex: 1, justifyContent: 'space-between' }}>
        <View style={styles.row}>
          <Text style={[styles.mono, { color: p.ink }]}>
            {dp.weekday} {dp.time}
          </Text>
          <Text style={[styles.mono, { color: p.ink }]}>{show.venue.neighborhood.toUpperCase()}</Text>
        </View>
        <View>
          <Text
            style={[styles.posterText, { color: p.ink, fontSize: headSize, lineHeight: headSize * 1.02 }]}
            numberOfLines={3}
            adjustsFontSizeToFit
            minimumFontScale={0.5}>
            {head}
          </Text>
          {support ? (
            <Text
              style={[styles.block, { color: p.ink, fontSize: supportSize, lineHeight: supportSize * 1.15, marginTop: 10 }]}
              numberOfLines={4}
              adjustsFontSizeToFit
              minimumFontScale={0.6}>
              + {support}
            </Text>
          ) : null}
        </View>
        <View style={[styles.row, { alignItems: 'flex-end' }]}>
          <Text style={[styles.posterText, { color: p.accent, fontSize: w * 0.17, lineHeight: w * 0.18 }]}>
            {dp.month} {dp.day}
          </Text>
          <Text
            style={[styles.block, { color: p.ink, fontSize: 13, textAlign: 'right', maxWidth: inner * 0.45 }]}
            numberOfLines={2}>
            {show.venue.name.toUpperCase()}
          </Text>
        </View>
      </View>
    </View>
  );
}

/** Layout B: inverted, tilted headliner band with a date sticker. */
function BandPoster({ show, width: w, height: h, p, seed }: Props & { p: PosterPalette; seed: number }) {
  const pad = Math.round(w * 0.07);
  const inner = w - pad * 2;
  const head = showTitle(show).toUpperCase();
  const rest = supportActs(show).map((a) => a.toUpperCase());
  const dp = dateParts(show);
  const headSize = fitFont(head, inner - 24, 2, CHAR_W.poster, h * 0.2, 30);
  const sticker = w * 0.3;
  return (
    <View style={[styles.poster, { width: w, height: h, backgroundColor: p.bg }]}>
      <Stripes w={w} h={h} p={p} seed={seed} />
      <View
        style={[
          styles.sticker,
          {
            width: sticker,
            height: sticker,
            borderRadius: sticker / 2,
            backgroundColor: p.accent,
            top: pad,
            right: pad,
          },
        ]}>
        <Text style={[styles.block, { color: p.bg, fontSize: sticker * 0.14 }]}>{dp.month}</Text>
        <Text style={[styles.posterText, { color: p.bg, fontSize: sticker * 0.42, lineHeight: sticker * 0.46 }]}>
          {dp.day}
        </Text>
        <Text style={[styles.mono, { color: p.bg, fontSize: 10 }]}>{dp.weekday}</Text>
      </View>
      <View style={{ flex: 1, padding: pad, justifyContent: 'flex-end' }}>
        <View style={{ transform: [{ rotate: '-5deg' }], marginBottom: 20, marginHorizontal: -pad / 2 }}>
          <View style={{ backgroundColor: p.ink, paddingHorizontal: 12 + pad / 2, paddingVertical: 8 }}>
            <Text
              style={[styles.posterText, { color: p.bg, fontSize: headSize, lineHeight: headSize * 1.04 }]}
              numberOfLines={2}
              adjustsFontSizeToFit
              minimumFontScale={0.5}>
              {head}
            </Text>
          </View>
        </View>
        {rest.slice(0, 4).map((a) => (
          <Text key={a} style={[styles.block, { color: p.ink, fontSize: 17, lineHeight: 22 }]} numberOfLines={1}>
            {a}
          </Text>
        ))}
        {rest.length > 4 ? (
          <Text style={[styles.mono, { color: p.ink }]}>+ {rest.length - 4} MORE</Text>
        ) : null}
        <View style={[styles.rule, { backgroundColor: p.ink, marginTop: 14 }]} />
        <View style={[styles.row, { marginTop: 8 }]}>
          <Text style={[styles.mono, { color: p.ink }]} numberOfLines={1}>
            {show.venue.name.toUpperCase()}
          </Text>
          <Text style={[styles.mono, { color: p.ink }]}>{dp.time}</Text>
        </View>
      </View>
    </View>
  );
}

/** Layout C: zine listing with a giant background numeral and ruled rows. */
function ZinePoster({ show, width: w, height: h, p, seed }: Props & { p: PosterPalette; seed: number }) {
  const pad = Math.round(w * 0.07);
  const inner = w - pad * 2;
  const dp = dateParts(show);
  const acts = show.acts.length ? [...show.acts].sort((a, b) => a.order - b.order).map((a) => a.name) : [showTitle(show)];
  const head = acts[0].toUpperCase();
  const headSize = fitFont(head, inner, 2, CHAR_W.poster, h * 0.17, 28);
  return (
    <View style={[styles.poster, { width: w, height: h, backgroundColor: p.bg }]}>
      <Grain w={w} h={h} p={p} seed={seed} />
      <Text
        style={[
          styles.posterText,
          {
            position: 'absolute',
            right: -w * 0.04,
            top: h * 0.02,
            fontSize: h * 0.62,
            lineHeight: h * 0.66,
            color: p.accent,
            opacity: 0.85,
          },
        ]}>
        {dp.day}
      </Text>
      <View style={{ flex: 1, padding: pad, justifyContent: 'space-between' }}>
        <View>
          <Text style={[styles.posterText, { color: p.ink, fontSize: 44, lineHeight: 46 }]}>{dp.month}</Text>
          <Text style={[styles.mono, { color: p.ink }]}>
            {dp.weekday} · {dp.time}
          </Text>
        </View>
        <View>
          <Text
            style={[styles.posterText, { color: p.ink, fontSize: headSize, lineHeight: headSize * 1.03 }]}
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.5}>
            {head}
          </Text>
          {acts.slice(1, 5).map((a) => (
            <View key={a}>
              <View style={[styles.rule, { backgroundColor: p.ink, marginVertical: 6 }]} />
              <Text style={[styles.block, { color: p.ink, fontSize: 16 }]} numberOfLines={1}>
                {a.toUpperCase()}
              </Text>
            </View>
          ))}
          <View style={[styles.rule, { backgroundColor: p.ink, marginVertical: 6, height: 3 }]} />
          <Text style={[styles.mono, { color: p.ink }]} numberOfLines={1}>
            {show.venue.name.toUpperCase()} — {show.venue.neighborhood.toUpperCase()}
          </Text>
        </View>
      </View>
    </View>
  );
}

function FlyerArtImpl({ show, width, height }: Props) {
  const seed = hash(show.id);
  const p = paletteFor(show.id, show.genres);
  const variant = seed % 3;
  if (variant === 0) return <StackPoster show={show} width={width} height={height} p={p} seed={seed} />;
  if (variant === 1) return <BandPoster show={show} width={width} height={height} p={p} seed={seed} />;
  return <ZinePoster show={show} width={width} height={height} p={p} seed={seed} />;
}

export const FlyerArt = memo(FlyerArtImpl);

/** Small square thumbnail for lists. */
export function FlyerThumb({ show, size }: { show: Show; size: number }) {
  const p = paletteFor(show.id, show.genres);
  const dp = dateParts(show);
  const name = headliner(show).toUpperCase();
  return (
    <View style={[styles.poster, { width: size, height: size, backgroundColor: p.bg, borderRadius: 10, padding: 6 }]}>
      <Text style={[styles.posterText, { color: p.accent, fontSize: size * 0.34, lineHeight: size * 0.36 }]}>
        {dp.day}
      </Text>
      <Text style={[styles.block, { color: p.ink, fontSize: size * 0.13 }]} numberOfLines={2}>
        {name}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  poster: { overflow: 'hidden' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  mono: { fontFamily: F.monoBold, fontSize: 11, letterSpacing: 0.5 },
  posterText: { fontFamily: F.poster, includeFontPadding: false },
  block: { fontFamily: F.block, includeFontPadding: false },
  sticker: { position: 'absolute', alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  rule: { height: 2, alignSelf: 'stretch' },
});
