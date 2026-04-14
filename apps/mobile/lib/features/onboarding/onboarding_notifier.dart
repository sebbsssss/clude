import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/storage/secure_storage_provider.dart';
import 'onboarding_state.dart';

class OnboardingNotifier extends StateNotifier<OnboardingState> {
  OnboardingNotifier(this._ref) : super(const OnboardingState());

  final Ref _ref;

  static const int totalSteps = 4;

  Future<void> checkAndStart() async {
    final storage = _ref.read(secureStorageProvider);
    final isComplete = await storage.isOnboardingComplete();
    if (isComplete) return;
    state = state.copyWith(isActive: true, currentStep: 0);
  }

  void advanceStep() {
    if (!state.isActive) return;
    final next = state.currentStep + 1;
    if (next >= totalSteps) {
      complete();
    } else {
      state = state.copyWith(currentStep: next);
    }
  }

  Future<void> complete() async {
    state = state.copyWith(isActive: false, completed: true);
    final storage = _ref.read(secureStorageProvider);
    await storage.setOnboardingComplete();
  }

  Future<void> skip() => complete();

  /// Debug only: force-start onboarding regardless of conditions.
  void forceStart() {
    state = const OnboardingState(isActive: true, currentStep: 0);
  }
}
