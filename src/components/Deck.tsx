import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { C, F } from '@/constants/theme';
import { usePriceUi } from '@/hooks/usePriceUi';
import { metaLine, placeLabel, showTitle, timeLabel } from '@/lib/showText';
import { relativeDay, wall, wallNow } from '@/lib/time';
import type { Decision, Show } from '@/lib/types';
import { FlyerArt } from './FlyerArt';
import { InfoSlide } from './InfoSlide';

export type DeckHandle = { swipe: (d: Decision) => void };

type DeckProps = {
  queue: Show[];
  width: number;
  height: number;
  /** Signed drag, -1 (pass) … 1 (going), for the audio fade. */
  drag: SharedValue<number>;
  enterFrom?: { id: string; side: 'left' | 'right' } | null;
  onDecide: (show: Show, d: Decision) => void;
  onOpen: (show: Show) => void;
  renderAudio: (show: Show, isTop: boolean) => ReactNode;
};

const INFO_H = 68;
const CHIPS_H = 40;
const AUDIO_H = 58;

export function cardLayout(width: number, height: number) {
  const cardW = Math.min(width - 24, 460);
  const flyerH = Math.max(220, Math.min(Math.round(cardW * 1.25), height - INFO_H - CHIPS_H - AUDIO_H - 28));
  return { cardW, flyerH, cardH: flyerH + INFO_H + CHIPS_H + AUDIO_H };
}

export const Deck = forwardRef<DeckHandle, DeckProps>(function Deck(props, ref) {
  const { queue, width, height, drag } = props;
  const { cardW, flyerH, cardH } = cardLayout(width, height);
  const topRef = useRef<CardHandle>(null);
  const topId = queue[0]?.id;

  useImperativeHandle(ref, () => ({
    swipe: (d) => topRef.current?.flyOut(d),
  }));

  useEffect(() => {
    drag.value = 0;
  }, [topId, drag]);

  const visible = queue.slice(0, 3);
  return (
    <View style={[styles.deck, { width, height }]}>
      {visible
        .map((show, i) => (
          <Card
            key={show.id}
            ref={i === 0 ? topRef : undefined}
            show={show}
            depth={i}
            width={cardW}
            flyerH={flyerH}
            cardH={cardH}
            drag={drag}
            enterFrom={props.enterFrom?.id === show.id ? props.enterFrom.side : undefined}
            onDecide={props.onDecide}
            onOpen={props.onOpen}
            audio={props.renderAudio(show, i === 0)}
          />
        ))
        .reverse()}
    </View>
  );
});

type CardHandle = { flyOut: (d: Decision) => void };

type CardProps = {
  show: Show;
  depth: number;
  width: number;
  flyerH: number;
  cardH: number;
  drag: SharedValue<number>;
  enterFrom?: 'left' | 'right';
  onDecide: (show: Show, d: Decision) => void;
  onOpen: (show: Show) => void;
  audio: ReactNode;
};

const Card = forwardRef<CardHandle, CardProps>(function Card(p, ref) {
  const { show, depth, width, flyerH, drag } = p;
  const priceUi = usePriceUi();
  const isTop = depth === 0;
  const reduceMotion = useReducedMotion();
  const threshold = width * 0.35;
  const startX = p.enterFrom ? (p.enterFrom === 'right' ? width * 1.4 : -width * 1.4) : 0;
  const tx = useSharedValue(startX);
  const ty = useSharedValue(0);
  const fade = useSharedValue(1);
  const zoom = useSharedValue(1);
  const [slide, setSlide] = useState(0);
  const slides = 2;

  useEffect(() => {
    if (startX !== 0) {
      tx.value = withSpring(0, { damping: 18, stiffness: 160 });
    }
    // Only on mount: an undone card flies back in from the side it left.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const decide = (d: Decision) => p.onDecide(show, d);
  const open = () => p.onOpen(show);
  const step = (dir: number) => setSlide((s) => Math.min(slides - 1, Math.max(0, s + dir)));

  const flyOut = (d: Decision) => {
    const dir = d === 'going' ? 1 : -1;
    if (reduceMotion) {
      fade.value = withTiming(0, { duration: 120 }, (done) => {
        if (done) scheduleOnRN(decide, d);
      });
      return;
    }
    drag.value = withTiming(dir, { duration: 200 });
    tx.value = withTiming(dir * width * 1.5, { duration: 240 }, (done) => {
      if (done) scheduleOnRN(decide, d);
    });
  };

  useImperativeHandle(ref, () => ({ flyOut }));

  const pan = Gesture.Pan()
    .enabled(isTop)
    // Two fingers are a pinch, never a swipe.
    .maxPointers(1)
    .activeOffsetX([-10, 10])
    .activeOffsetY([-14, 14])
    .onUpdate((e) => {
      tx.value = e.translationX;
      ty.value = e.translationY;
      drag.value = Math.max(-1, Math.min(1, e.translationX / threshold));
    })
    .onEnd((e) => {
      const right = e.translationX > threshold || (e.velocityX > 900 && e.translationX > 40);
      const left = e.translationX < -threshold || (e.velocityX < -900 && e.translationX < -40);
      if (right || left) {
        const dir = right ? 1 : -1;
        drag.value = dir;
        ty.value = withTiming(ty.value + e.velocityY * 0.08, { duration: 220 });
        tx.value = withTiming(dir * width * 1.5, { duration: 220 }, (done) => {
          if (done) scheduleOnRN(decide, right ? 'going' : 'passed');
        });
        return;
      }
      tx.value = withSpring(0, { damping: 18, stiffness: 180 });
      ty.value = withSpring(0, { damping: 18, stiffness: 180 });
      drag.value = withSpring(0);
    });

  // Spread two fingers apart to open the full details. Opening only when the
  // fingers lift lets someone who spreads by accident pinch back to cancel.
  const pinch = Gesture.Pinch()
    .enabled(isTop)
    .onUpdate((e) => {
      zoom.value = Math.max(1, Math.min(1.2, e.scale));
    })
    .onEnd((e) => {
      const opened = e.scale > 1.3;
      zoom.value = withSpring(1, { damping: 18, stiffness: 180 });
      if (opened) scheduleOnRN(open);
    });

  const gestures = Gesture.Simultaneous(pan, pinch);

  const tap = Gesture.Tap()
    .enabled(isTop)
    .maxDistance(10)
    .onEnd((e, success) => {
      if (!success) return;
      scheduleOnRN(step, e.x < width / 2 ? -1 : 1);
    });

  const cardStyle = useAnimatedStyle(() => {
    if (depth === 0) {
      return {
        opacity: fade.value,
        transform: [
          { translateX: tx.value },
          { translateY: ty.value * 0.4 },
          { rotate: `${(tx.value / width) * 10}deg` },
          { scale: zoom.value },
        ],
      };
    }
    const d = Math.abs(drag.value);
    const base = depth === 1 ? 0.95 : 0.9;
    const next = depth === 1 ? 1 : 0.95;
    const yBase = depth === 1 ? 12 : 24;
    const yNext = depth === 1 ? 0 : 12;
    return {
      opacity: 1,
      transform: [
        { translateY: interpolate(d, [0, 1], [yBase, yNext], Extrapolation.CLAMP) },
        { scale: interpolate(d, [0, 1], [base, next], Extrapolation.CLAMP) },
      ],
    };
  });

  const goingStamp = useAnimatedStyle(() => ({
    opacity: depth === 0 ? interpolate(tx.value, [20, 110], [0, 1], Extrapolation.CLAMP) : 0,
  }));
  const passStamp = useAnimatedStyle(() => ({
    opacity: depth === 0 ? interpolate(tx.value, [-110, -20], [1, 0], Extrapolation.CLAMP) : 0,
  }));

  const start = wall(show.startsAt);
  const today = wallNow(show.startsAt);
  return (
    <GestureDetector gesture={gestures}>
      <Animated.View
        style={[styles.card, { width, height: p.cardH }, cardStyle]}
        accessible={isTop}
        accessibilityLabel={`${showTitle(show)} at ${show.venue.name}, ${relativeDay(start, today)}`}
        accessibilityActions={[
          { name: 'going', label: 'Going' },
          { name: 'pass', label: 'Pass' },
          { name: 'activate', label: 'Show details' },
        ]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'going') flyOut('going');
          else if (e.nativeEvent.actionName === 'pass') flyOut('passed');
          else open();
        }}>
        <GestureDetector gesture={tap}>
          <View style={{ width, height: flyerH }}>
            {slide === 0 ? (
              <FlyerArt show={show} width={width} height={flyerH} />
            ) : (
              <InfoSlide show={show} width={width} height={flyerH} />
            )}
            <View style={styles.dashes} pointerEvents="none">
              {Array.from({ length: slides }).map((_, i) => (
                <View key={i} style={[styles.dash, i === slide && styles.dashOn]} />
              ))}
            </View>
            <Animated.View style={[styles.stamp, styles.stampGoing, goingStamp]} pointerEvents="none">
              <Text style={[styles.stampText, { color: C.accent }]}>GOING</Text>
            </Animated.View>
            <Animated.View style={[styles.stamp, styles.stampPass, passStamp]} pointerEvents="none">
              <Text style={[styles.stampText, { color: C.pass }]}>PASS</Text>
            </Animated.View>
          </View>
        </GestureDetector>
        {p.audio}
        <Pressable style={styles.info} onPress={open} accessibilityRole="button" accessibilityLabel="Show details">
          <Text style={styles.when} numberOfLines={1}>
            {relativeDay(start, today)} · {timeLabel(show)}
          </Text>
          <Text style={styles.where} numberOfLines={1}>
            {placeLabel(show)}
          </Text>
          {metaLine(show, priceUi) ? (
            <Text style={styles.meta} numberOfLines={1}>
              {metaLine(show, priceUi)}
            </Text>
          ) : null}
        </Pressable>
        <View style={styles.chips}>
          {show.genres.slice(0, 3).map((g) => (
            <View key={g} style={styles.chip}>
              <Text style={styles.chipText}>{g}</Text>
            </View>
          ))}
        </View>
      </Animated.View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  deck: { alignItems: 'center', justifyContent: 'flex-start', paddingTop: 6 },
  card: {
    position: 'absolute',
    top: 6,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
  },
  dashes: { position: 'absolute', top: 10, left: 12, right: 12, flexDirection: 'row', gap: 6 },
  dash: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.25)' },
  dashOn: { backgroundColor: 'rgba(255,255,255,0.9)' },
  stamp: {
    position: 'absolute',
    top: 44,
    borderWidth: 4,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 2,
    backgroundColor: 'rgba(12,11,10,0.55)',
  },
  stampGoing: { left: 20, borderColor: C.accent, transform: [{ rotate: '-14deg' }] },
  stampPass: { right: 20, borderColor: C.pass, transform: [{ rotate: '14deg' }] },
  stampText: { fontFamily: F.poster, fontSize: 40, letterSpacing: 2 },
  info: { height: INFO_H, paddingHorizontal: 14, paddingTop: 10, gap: 1 },
  when: { fontFamily: F.uiBold, color: C.text, fontSize: 15 },
  where: { fontFamily: F.ui, color: C.text, fontSize: 13 },
  meta: { fontFamily: F.uiRegular, color: C.muted, fontSize: 12 },
  chips: { height: CHIPS_H, flexDirection: 'row', gap: 6, paddingHorizontal: 14, alignItems: 'center' },
  chip: { borderWidth: 1, borderColor: C.line, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  chipText: { fontFamily: F.ui, color: C.muted, fontSize: 12 },
});
