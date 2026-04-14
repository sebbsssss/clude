import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'onboarding_notifier.dart';
import 'onboarding_state.dart';

final onboardingProvider =
    StateNotifierProvider<OnboardingNotifier, OnboardingState>(
  (ref) => OnboardingNotifier(ref),
);
