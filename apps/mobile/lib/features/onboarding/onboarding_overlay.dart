import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'onboarding_keys.dart';
import 'onboarding_notifier.dart';
import 'onboarding_provider.dart';
import 'widgets/coach_tooltip.dart';
import 'widgets/spotlight_overlay.dart';

const _stepTexts = [
  'Welcome to Clude! Your AI companion with persistent memory. Let\'s take a quick tour.',
  'Choose your AI model. Free and pro tiers available.',
  'Tap here to start your first conversation.',
  'Your USDC balance. Tap to top up anytime.',
];

class OnboardingOverlay extends ConsumerStatefulWidget {
  const OnboardingOverlay({super.key, required this.child});

  final Widget child;

  @override
  ConsumerState<OnboardingOverlay> createState() => _OnboardingOverlayState();
}

class _OnboardingOverlayState extends ConsumerState<OnboardingOverlay> {
  @override
  Widget build(BuildContext context) {
    final state = ref.watch(onboardingProvider);
    final keys = ref.watch(onboardingKeysProvider);

    if (!state.isActive) return widget.child;

    final targetKey = keys.keyForStep(state.currentStep);
    if (targetKey == null) return widget.child;

    // Target widget not yet rendered — show child only.
    // ref.watch(onboardingProvider) will rebuild when state changes,
    // and the target widget attaching the key triggers a natural rebuild.
    if (targetKey.currentContext == null) {
      // Schedule a single post-frame check in case the key was just attached.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && targetKey.currentContext != null) {
          setState(() {});
        }
      });
      return widget.child;
    }

    return Stack(
      children: [
        widget.child,
        Positioned.fill(
          child: SpotlightOverlay(targetKey: targetKey),
        ),
        CoachTooltip(
          targetKey: targetKey,
          text: _stepTexts[state.currentStep],
          currentStep: state.currentStep,
          totalSteps: OnboardingNotifier.totalSteps,
          onNext: () => ref.read(onboardingProvider.notifier).advanceStep(),
          onSkip: () => ref.read(onboardingProvider.notifier).skip(),
        ),
      ],
    );
  }
}
