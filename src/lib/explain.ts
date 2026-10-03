import { Alert } from 'react-native';

/** Plain-language explanation shown before the system permission prompt. Resolves true when the person continues. */
export function explainFirst(title: string, message: string, continueLabel = 'Continue'): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
        { text: continueLabel, onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

export const LOCATION_EXPLAINER = {
  title: 'Use your location?',
  message:
    'Pull Up uses your phone’s approximate location once, on this phone, to pick the nearest city and sort shows by distance. It is never sent to Pull Up or anyone else. You can choose a city by hand instead.',
  continueLabel: 'Continue',
} as const;

export const NOTIFICATION_EXPLAINER = {
  title: 'Allow reminders?',
  message:
    'Pull Up can remind you about shows you mark as going: the day before, the day of, and an hour before doors. Reminders are created on this phone and nothing is sent to a server.',
  continueLabel: 'Continue',
} as const;
