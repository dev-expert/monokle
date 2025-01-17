import React, {useCallback, useMemo} from 'react';
import {NavSectionItemCustomComponentProps} from '@models/navsection';
import {useAppDispatch, useAppSelector} from '@redux/hooks';
import {selectHelmValuesFile} from '@redux/reducers/main';
import {startPreview, stopPreview} from '@redux/services/preview';
import {ExitHelmPreviewTooltip, HelmPreviewTooltip, ReloadHelmPreviewTooltip} from '@constants/tooltips';
import QuickActionPreview from '@components/molecules/QuickActionPreview';
import {HelmValuesFile} from '@models/helm';

const QuickAction = (props: NavSectionItemCustomComponentProps<HelmValuesFile>) => {
  const {item, isItemSelected, isItemHovered} = props;
  const dispatch = useAppDispatch();
  const selectedValuesFileId = useAppSelector(state => state.main.selectedValuesFileId);
  const previewValuesFileId = useAppSelector(state => state.main.previewValuesFileId);

  const isItemBeingPreviewed = useMemo(
    () => previewValuesFileId !== undefined && previewValuesFileId === item.id,
    [previewValuesFileId, item]
  );

  const selectAndPreviewKustomization = useCallback(() => {
    if (item.id !== selectedValuesFileId) {
      dispatch(selectHelmValuesFile({valuesFileId: item.id}));
    }
    if (item.id !== previewValuesFileId) {
      startPreview(item.id, 'helm', dispatch);
    } else {
      stopPreview(dispatch);
    }
  }, [item, selectedValuesFileId, previewValuesFileId]);

  const reloadPreview = useCallback(() => {
    if (item.id !== selectedValuesFileId) {
      dispatch(selectHelmValuesFile({valuesFileId: item.id}));
    }

    startPreview(item.id, 'helm', dispatch);
  }, [item, selectedValuesFileId]);

  if (!isItemHovered) {
    return null;
  }

  return (
    <QuickActionPreview
      isItemSelected={isItemSelected}
      isItemBeingPreviewed={isItemBeingPreviewed}
      previewTooltip={HelmPreviewTooltip}
      reloadPreviewTooltip={ReloadHelmPreviewTooltip}
      exitPreviewTooltip={ExitHelmPreviewTooltip}
      selectAndPreview={selectAndPreviewKustomization}
      reloadPreview={reloadPreview}
    />
  );
};

export default QuickAction;
