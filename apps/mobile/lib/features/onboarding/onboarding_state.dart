import 'package:freezed_annotation/freezed_annotation.dart';

part 'onboarding_state.freezed.dart';

@freezed
class OnboardingState with _$OnboardingState {
  const factory OnboardingState({
    @Default(false) bool isActive,
    @Default(0) int currentStep,
    @Default(false) bool completed,
  }) = _OnboardingState;
}
